// entropyserver.js  A JSON API that serves entropy
//
// Copyright (c) 2014 NZ Registry Services
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

"use strict";

/*** SETUP  ***/

// import packages
var ftdi        = require('ftdi');
var express     = require('express');
var fs          = require('fs');

// config and global variables
var DEFAULT_MINREQUESTBYTES = 64;
var DEFAULT_MAXREQUESTBYTES = 4096;
var DEFAULT_PORT = 11372;
var DEFAULT_BUFFERSIZE = 67108864;

var config = loadconfig();
var app = express();                                          // define our app using express
var router = express.Router();                                // get an instance of the express router
var circ = new CircularBuffer(config.buffersize);             // the buffer to hold the random bytes

// initiaisation
initialiseRNG();
setuprouter();

// start the server
app.listen(config.port);
console.log("Entropy server started on port " + config.port.toString());


/*** ROUTES ***/

function setuprouter() {
  // base route that nobody should be using (accessed at GET http://localhost:11372/api)
  router.get("/", function(req, res) {
    res.json({ message: "RNG server" }); 
  });

  // server info route
  router.get("/info/", function(req, res) {
    res.json( { server: config.server, 
                protocolversions: config.protocolversions,
                source: config.source,
                bitsofentropy: config.bitsofentropy,
                minrequestbytes: config.minrequestbytes,
                maxrequestbytes: config.maxrequestbytes,
                ratelimits: config.ratelimits });
  });

  // main API route
  router.get("/entropy/", function(req, res) {
    var bytes = req.query.bytes;
    var d;

    bytes = parseInt(bytes);
    bytes = (bytes < config.minrequestbytes) ? config.minrequestbytes : bytes;
    bytes = (bytes > config.maxrequestbytes) ? config.maxrequestbytes : bytes;
    console.log("bytes to be served: " + bytes.toString());

    d = circ.pop(bytes);

    res.json({ bytes: bytes, entropy: d});
  });

  // register routes with /api prefix
  app.use('/api', router);
}


/*** CONFIG ***/

function loadconfig() {
  var cfgjson = fs.readFileSync('./entropyserver.json');
  var cfg;

  try {
    cfg = JSON.parse(cfgjson);                                // parse the JSON file
  }
  catch (err) {
    console.log("Error parsing config file");
    console.log(err);
    process.exit(1);                                          // exit with a non-sero error code TODO make that a global variable
  }

  checkconfigitem(cfg.server, "server");
  checkconfigitem(cfg.protocolversions, "protocolversions");
  checkconfigitem(cfg.source, "source");
  checkconfigitem(cfg.bitsofentropy, "bitsofentropy");

  cfg.minrequestbytes = cfg.minrequestbytes || DEFAULT_MINREQUESTBYTES;
  cfg.maxrequestbytes = cfg.maxrequestbytes || DEFAULT_MAXREQUESTBYTES;
  cfg.ratelimits = cfg.ratelimits || [];

  cfg.buffersize = cfg.buffersize || DEFAULT_BUFFERSIZE;
  cfg.port = cfg.port || process.env.PORT || DEFAULT_PORT;

  return cfg;
}

function checkconfigitem(item, text) {
  if (item === null || item === undefined) {                  // if this item doesn't exist then error and exit
    console.log('Error, "' + text + '": missing in config file.');
    process.exit(1);
  }
}


/*** RNG ***/

function initialiseRNG() {
  ftdi.find(0x0403, 0x6014, function(err, devices) {
    var device = new ftdi.FtdiDevice(devices[0]);

    device.on('error', function(err) {});                     // set up the error handler - TODO write one!

    device.open({}, function(err) {

      device.on('data', recvdata);                            // set up the new data handler
      device.write([0xe0, 0x96], function(err) { });          // issue start and stop command

    });

  });
}

function recvdata(data) {                                     // used to ensure we send data to the correct object
  circ.push(data);
}


/*** CIRCULAR BUFFER to handle the RNG data ***/

function CircularBuffer(initialsize) {
  this._data = new Array(initialsize);
  this._last = initialsize - 1;
  this._readindex = 0;
  this._dataindex = 0;
  // the two index pointers can be equal in one of two states, one where the buffer is full and one where it is empty
  // when _datafirst == true then either _dataindex > _readindex or _dataindex == _readindex and the buffer is empty
  // when _datafirst == false then either _dataindex < _readindex or _dataindex == _readindex and the buffer is full
  this._datafirst = true;                                     // _dataindex is running ahead of the _readindex
  this._mutex = 0;                                            // used for mutex operations
}

CircularBuffer.prototype.bytesremaining = function() {         // not mutex protected !!
  var b;

  if (this._datafirst) {
    b = this._dataindex - this._readindex;                    // simple case - _dataindex to the end
  } else {
    b = (this._last - this._readindex) + 1 + this._dataindex; // add the two bits at the front and back
  }
  return b;
}

CircularBuffer.prototype.push = function(newdata) {
//  console.log("push called with " + newdata.length.toString() + " bytes");
  this._usemutex(this._mutexpush, [newdata]);
//  console.log("finished pushing.  _dataindex: " + this._dataindex.toString());
  return this;
}

CircularBuffer.prototype._mutexpush = function(d) {
  var i, l1, l2;

  if (this._datafirst)  {                                     // fill from _dataindex to end of array
    l1 = d.length > (this._last - this._dataindex) ? (this._last - this._dataindex) : d.length;  // the maximum amount of data we can receive depends on the remaining space in the buffer

    for (i = 0; i < l1; i++) {
      this._data[this._dataindex + i] = d[i];                 // read data into the buffer, ensuring we don't write too much
    }

    this._dataindex += l1;                                    // increment data pointer for new data

    if (l1 < d.length && this._readindex > 0) {               // if there is more data and readindex > 0 then we have can overwrite the used part at the front of the array
      l2 = (d.length - l1) > this._readindex ? this._readindex : (d.length - l1);   // do we have enough bytes left to fill all of the missing data

      for (i = 0; i < l2; i++) {                              // fill the start of the array
        this._data[i] = d[l1 + i];
      }

      this._dataindex = l2;                                   // dataindex now sets back behind the readindex
      this._datafirst = false;                                // cycle is complete
    }

  } else {

    l1 = (this._readindex - this._dataindex) > d.length ? d.length : (this._readindex - this._dataindex);  // how much data do we need from the array to fill the buffer

    for (i = 0; i < l1; i++) {
      this._data[this._dataindex + i] = d[i];
    }

    this._dataindex += l1;                                    // increment data pointer for new data
  }
}

CircularBuffer.prototype.pop = function (count) {
  var ret = false;

//  console.log("pop called for " + count.toString() + " bytes");

  // TODO it might be better without the following line and just let the more aggressive line after it handle this case
  // wait until enough data - there is a danger this never completes if request is large and smaller requests keep taking the data as it is added
  while (count > this.bytesremaining()) { 
    console.log("Need " + count.toString() + " bytes but only " + this.bytesremaining() + " remaining.");
  }

  while (ret === false) {
    ret = this._usemutex(this._mutexpop, [count]);            // keep trying it until it succeeds
//    console.log("_mutexpop returned " + ret.toString());
  }
  return ret;
}


CircularBuffer.prototype._mutexpop = function(count) {
  var d, i, endbit;

  if (count > this.bytesremaining()) {
    return false;                                             // not quick enough getting here so fo back and try again
  } else {

    d = new Array(count);                                     // create array to hold the output to return
    endbit = this._last - this._readindex;                    // the first part we get


    if (this._datafirst || (count <= endbit) ) {              // simple case, just grab what we need from the _readindex onwards
      for (i = 0; i < count; i++) {
        d[i] = this._data[this._readindex + i];               // copy the data
      }
      this._readindex += count;                               // increment the _readindex

    } else {                                                  // will need to get the data in two bits, first from the end and then from the front

      for (i = 0; i < endbit; i++) {                          // grab it all from _readindex until the end
        d[i] = this._dataindex[this._readindex + i];
      }

      for (i = 0; i < (count - endbit); i++) {                // grab the remainder off the front
        d[i + endbit] = this._data[i];
      }

      this._readindex = count - endbit;                       // reset the _readindex round to the back
      this._datafirst = true;                                 // change state

    }
  }
  return d;
}

CircularBuffer.prototype._usemutex = function(func, params) {
  var succeed = false;
  var ret;

  while (!succeed) {
    while (this._mutex > 0) {                                   // wait until the mutex is free
      console.log("waiting for mutex");
    } 
    this._mutex++;                                              // increment the mutex
    if (this._mutex > 1) {                                      // double lock so back off
      // TODO may need random sleep here
      this._mutex--;
    } else {
      ret = func.apply(this, params);
      succeed = true;
      this._mutex--;
    }
  }

  return ret;
}
