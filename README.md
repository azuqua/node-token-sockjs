Node Token Sockjs Server
========================

[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]

[npm-image]: https://img.shields.io/npm/v/node-token-sockjs.svg?style=flat
[npm-url]: https://npmjs.org/package/node-token-sockjs
[downloads-image]: https://img.shields.io/npm/dm/node-token-sockjs.svg?style=flat
[downloads-url]: https://npmjs.org/package/node-token-sockjs

A wrapper around [Express](http://expressjs.com/), [Sockjs](https://github.com/sockjs/sockjs-node), and [Redis](http://redis.io/) that provides addtional websocket functionality.

This module is designed to support higher level application functionality on top of websockets or websocket emulation via sockjs. Currently this module provides a token-based authentication mechanism, a publish-subscribe interface, and a bidirectional RPC interface. 

[The client libraries can be found here.](https://github.com/azuqua/token-sockjs-client)

# Install

	npm install node-token-sockjs

# API Overview

## Initialization

This module supports the following initialization parameters. The first three named arguments are required and the last options object is optional.

```
var tokenServer = new TokenSocketServer(app, redisClient, socketServer, options);
```

* **app** - The express application used for HTTP routing.
* **redisClient** - The redis client to use for non pub/sub commands. 
* **socketServer** - The sockjs server instance this module should manage.

The following properties are optional on the options object.

* **prefix** - The route prefix that the sockjs server instance is bound to. The default value for this is "/sockets". This must match the client's configuration and the sockjs server instance configuration.
* **tokenRoute** - The route the client will use to attempt authentication. The default value for this is "/socket/token". This must match the client's configuration.
* **pubsubClient** - The redis client to use for pub/sub commands. This cannot be the same redis client used for non pub/sub commands.
* **socketController** - An object, arbitrarily nested, mapping RPC function names to functions. See the RPC section for more details. This can be modified dynamically at any time following initialization by editing the server instance's "socketController" object.
* **customMiddleware** - Any custom middleware to apply to the token authentication route.
* **authentication** - The authentication mechanism used to determine if a socket will be issued a token. This property can be a string or object. If it's a string then the module will check for the request session property keyed by this string. For example, the default value for this property is "auth" which will use the req.session.auth property to decide if the socket should get a token. This property can also be a function which will be passed the request object and a callback. If the callback is called with a truthy second parameter the socket will be issued a token. If the second parameter is an object then this object will be attached to the socket. If the second parameter is not an object then the request session object will be attached to the socket. See below for examples.
* **debug** - A boolean flag used to determine if the module should log relevant actions to the console.
* **routes** - An object, arbitrarily nested, mapping RPC function names to express route handler functions. This module will expose the express route functions as RPC endpoints for clients, most likely without requiring any changes to the express route handler function. Currently about 80% of the express API surface is implemented, however there are a few concepts that do not map cleanly from a websocket request to an HTTP request. Because of this a few functions and properties are not present on the standard "request" and "response" arguments passed to the express route functions. For a full list of what's implemented see the [utils](https://github.com/azuqua/node-token-sockjs/blob/master/lib/utils.js#L30) file that implements the mapping. **The "send" function is not implemented on the "response" argument passed to route handler functions** because it does not fit well into the request-response model implemented by the RPC interface. To send chunked data use the pubsub network or a RPC invokation from the server to the client. Also note that the websocket data will not be passed through the middleware queue. The client will be able to access the http headers with the "_headers" property and the response code with the "_code" property on the RPC response. See below for examples.

```
var express = require("express"),
	http = require("http"),
	redis = require("redis"),
	sockjs = require("sockjs"),
	TokenSocketServer = require("node-token-sockjs");

var redisClient = redis.createClient(),
	pubsubClient = redis.createClient();

var app = express(),
	socketServer = sockjs.createServer();

var server = http.createServer(app);

var socketOptions = {
	prefix: "/sockets",
    sockjs_url: "//cdn.sockjs.org/sockjs-0.3.min.js"
};
socketServer.installHandlers(server, socketOptions);

var authenticationFn = function(req, callback){
	doSomething(req, function(error){
		if(error)
			return callback(error); // socket will not be allowed to connect

		if(Math.random() < 0.5)
			callback(null, req.user); // socket will be issued a token and req.user will be attached to the socket
		else
			callback(null, true); // socket will be issued a token and req.session will be attached to the socket
	});
};

var readUsers = function(req, res){
	console.log("Got request to read users", req.hostname, req.ip, req.headers, req.query);
	User.read().then(function(users){
		res.json(users);
	})
	.catch(function(error){
		res.status(500);
		res.json({ error: error });
	});
};

app.get("/user/read", readUsers);

var controller = {
	
	echo: function(auth, data, callback){
		// here @auth is the second parameter from authenticationFn above, or req.session
		// see the RPC section below for more information
		callback(null, data);
	}
	
};

// this will be attached to the HTTP route used to issue tokens to sockets
var customMiddleware = function(req, res, next){
	req.foo = "bar";
	next();	
};

var tokenServer = new TokenSocketServer(app, redisClient, socketServer, {
	prefix: socketOptions.prefix,
	tokenRoute: "/socket/token",
	pubsubClient: pubsubClient,
	socketController: controller,
	customMiddleware: customMiddleware,
	authentication: authenticationFn,
	debug: app.get("env") !== "production",
	routes: {
		user: {
			read: readUsers // now this can be called via the RPC interface
		}
	}
});

```

## RPC Interface

This module supports a bidirectional RPC interface between the server and client. This means the client can issue calls to the server and the server can issue calls to the client with a simple function call/callback interface. The examples here will show how to use the RPC API surface from the server. See the [client docs](https://github.com/azuqua/token-sockjs-client#rpc-interface) for examples of RPC functions going in the other direction.

```
// set up this server to accept RPC commands from the clients
// these functions can be created at initalization with the socketController option or can be modified dynamically at run time
// these examples will assume the tokenServer already exists and show how to dynamically modify RPC functions

tokenServer.socketController.ping = function(auth, data, callback, socket){
	// @auth is the data attached to the socket upon authentication
	// @data is the data provided by the client when issuing the RPC call
	// @callback is a function used to issue the final response to the client
	// @socket is an optional parameter that can be used to issue inner RPC calls, pub/sub operations, etc.

	doSomethingAsync(data, function(error, result){
		if(error)
			callback(error);
		else
			callback(null, result);
	});

};

// call an RPC function on the client

var sockets = tokenServer.sockets();
setInterval(function(){
	var socket = sockets[Math.random() * (sockets.length - 1) | 0];
	tokenServer.rpc(socket, "saySomething", { bart: "Cant sleep clown will eat me" }, function(error, resp){
		console.log("Socket responded: ", error, resp);
	});
}, 1000);
```

## Events

The server is extended by an EventEmitter so developers can attach multiple event listeners to any event. Event listeners related to publish - subscribe actions (subscribe, publish, unsubscribe, broadcast) can be used to enforce access control to certain actions. See below for examples. 

**If multiple listener functions are bound to the same event only one of them needs to return an error or falsy value for the action to be disallowed.**

* **authentication** - Called when the socket successfully authenticates. The listener function will be called with the socket, authentication data, and a callback function. The callback function does not take any arguments.
* **subscribe** - Called when a socket attempts to subscribe to a channel. The listener function will be called the socket, subscription data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from subscribing.
* **unsubscribe** - Called when a socket attempts to unsubscribe from a channel. The listener function will be called with the socket, channel data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from unsubscribing.
* **publish** - Called when a socket attempts to publish data on a channel. The listener function will be called with the socket, publish data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from publishing.
* **broadcast** - Called when a socket attempts to broadcast data on all channels. The listener function will be called with the socket, broadcast data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from broadcasting.

```
tokenServer.on("authentication", function(socket, auth, callback){
	// maybe immediately say hello
	tokenServer.rpc(socket, "sayHello", { message: "hello, " + auth.email }, function(error, resp){
		console.log("Socket client says: ", error, resp);
		callback(); // the authentication event listener callback does not require any arguments
	});
});

// enforce access control to publish - subscribe events

tokenServer.on("subscribe", function(socket, data, callback){
	console.log("Socket attempting to subscribe: ", socket.auth, data.channel);
	callback(null, true); // socket will be allowed to subscribe
});

tokenServer.on("publish", function(socket, data, callback){
	console.log("Socket attempting to publish: ", socket.auth, data.channel, data.data);
	callback(null, false); // socket will not be allowed to publish
});

// when multiple listeners are bound to an event only one of them need return an error or falsy value for the action to be disallowed
// in this example the broadcast action will be disallowed

tokenServer.on("broadcast", function(socket, data, callback){
	console.log("Socket attempting to broadcast: ", socket.auth, data.data);
	callback(null, true); 
});

tokenServer.on("broadcast", function(socket, data, callback){
	console.log("Socket attempting to broadcast: ", socket.auth, data.data);
	callback(null, false); 
});

// listener functions can be removed with removeListener and removeAllListeners

tokenServer.removeAllListeners("authentication");
```

## Cleanup

Sockjs does not support cookie based authentication nor the passing of query parameters on a websocket HTTP upgrade request so it is not possible to entirely disallow a websocket connection. However, it is possible to force sockets to authenticate before they're allowed to do anything. If a socket does not identify itself within a certain amount of time it can be forced to disconnect. This module allows for setting a TTL on unauthenticated sockets in this manner.

```
// set a 5 second TTL 
tokenServer.enableCleanup(5000); 

// remove the TTL
tokenServer.disableCleanup();
```

## List Sockets

```
var sockets = tokenServer.sockets();
sockets.forEach(function(socket){
	console.log("Socket ID: ", socket.sid);
	console.log("Socket's channels: ", socket.channels);
	console.log("Socket's auth data: ", socket.auth);
});
```

# Publish - Subscribe Interface

Developers can also use the optional publish/subscribe interface by providing an additional redis client to the module's initialization parameters. 

TokenSocket clients can issue commands to subscribe themselves to channels or publish messages on a channel, however it is also possible for the server to perform pub/sub commands. 

## Publish a message

Publishes a message on a channel.

```
tokenServer.publish("channel", { foo: "bar" });
```

## Broadcast a message

Broadcasts a message on all channels. If this is running in a distributed environment with a shared redis host this will broadcast the message on all channels, not just the channels that sockets connected to this server instance are subscribed to. 

**This will send the message once on every channel currently known to redis. This means if a client is subscribed to five channels it will receive this message five times, once on each channel.**

```
tokenServer.broadcast({ foo: "bar" });
```

## Subscribe a socket to a channel

```
var sockets = tokenServer.sockets();
sockets.forEach(function(socket){
	tokenServer.subscribe(socket, "channel");
});
```

## Unsubscribe a socket from a channel

```
var sockets = tokenServer.sockets();
sockets.forEach(function(socket){
	tokenServer.unsubscribe(socket, "channel");
});

// or unsubscribe all sockets from a channel
tokenServer.unsubscribeAll("channel");
```

## List Channels

List the channels that sockets connected to this server instance have subscribed to.

```
var channels = tokenServer.channels();
channels.forEach(function(channel){
	tokenServer.publish(channel, { foo: "bar" });
});
```

## Shutdown

Shut down the server by closing all sockets and unsubscribing from all channels. This is synchronous.

```
tokenServer.shutdown();
```

# Tests

This module uses Mocha, Chai, and Sinon for testing. In order to run the tests make sure a local redis server is running on port 6379 or the REDIS_HOST and REDIS_PORT environment variables are set.

```
npm install
grunt
```
