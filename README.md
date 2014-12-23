# Entropy Server

A JSON API that serves entropy.

entropyserver is a node.js server that serves requests for entropy over a REST API.  The entropy comes from a hardware random source directly attached to the server.  Currently the only support device is a ComScire PQ32MU, which outputs random bytes at 32Mb/s.

The clients (unfinished) update /dev/random automatically by pulling data from the server.

This is ALPHA software but under active development.

## Security

This is still alpha software so the security model is likely to develop.  For now the security of the system is provided by:

1. The client is configured to use a specific entropy server and no discovery protocol is included (other than DNS).
1. Communication with the client is over HTTPS (not yet implemented)
1. The server certificate is distributed and expected to be installed with the client for the client to use.  There is no trust of X.509 Certificate Authorities. (not yet implemented)
1. The domain name of the server is DNSSEC signed, from the root down.(not yet implemented)
1. The internal buffer size can be adjusted to control how much entropy is stored in RAM before it is served.

## Dependencies

	ftdi
	express

## Config file

Configuration is in a JSON text file called entropyserver.json and example of which is:

    {
      "server": "entropy://entropy.net.nz/",
      "protocolversions": ["1.0"],
      "source": "ComScire PQ32MU",
      "bitsofentropy": 8,
      "minrequestbytes": 64,
      "maxrequestbytes": 4096,
      "ratelimits": [ {"period": 1000, "requests": 1, "bytes": 4096} ]
    }

The elements are:

+ **server** The URL of this server.  Should match the URL by which clients contact this server as it may be used as a verification item. (Required)
+ **protocolversions** List of protocol versions that this server supports.  Each version is given as a string. (Required)
+ **source** String that identifies the device that generates the entropy used by this server. (Required)
+ **bitsofentropy** Number of bits of entropy per byte of data provided. (Required)
+ **minrequestbytes** Minimum number of bytes that can be requested in a single request. (Optional, defaults to 64)
+ **maxrequestbytes** Maximum number of bytes that can be requested in a single request. (Optional, defaults to 4096)
+ **ratelimits** List of objects that define the rate limits enforced by this server.  (Optional, defaults to empty list) (not yet implemented)
++ **period** Period of time in milliseconds. (Required)
++ **requests** Total number of requests allowed within the period. (Required)
++ **bytes** Total number of bytes allowed to be requested within the period. (Required)
+ **buffersize**  How mamy bytes of entropy the server should buffer from the device. (Optional, defaults to 67108864)
+ **port** Port the server listens on.  (Optional, defaults to 11372)

## API

The default port the service is accessible on is:

    11372

The root of the interface is:

    /api/

Information on the server can be found at:

    /api/info/

_example output: (whitespace added)_

    {"server" : "entropy://entropy.net.nz/",
     "protocolversions" : ["1.0"],
     "source" : "ComScire PQ32MU",
     "bitsofentropy" : 8,
     "minrequestbytes" : 64,
     "maxrequestbytes" : 4096,
     "ratelimits" : []}

Entropy is requested by 

	/api/entropy?bytes=64

_example output:_

    {"bytes":64,"entropy":[191,235,79,33,150,135,6,94,78,105,69,134,154,10,101,67,145,37,191,2,202,69,4,166,16,229,182,132,178,61,222,82,135,146,124,195,2,43,61,196,108,243,223,75,107,20,135,162,29,253,44,72,102,224,89,69,173,20,187,174,201,25,183,21]}

## Known issues

The server crashes regularly with "Segmentation fault: 11" on OSX Yosemite.  AFAICT this is a bug in OSX that is affecting a number of different applications.
