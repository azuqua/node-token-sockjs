Node Token Sockjs Server
========================

A wrapper around [Express](http://expressjs.com/), [Sockjs](https://github.com/sockjs/sockjs-node), and [Redis](http://redis.io/) that provides addtional websocket functionality.

This module is designed to support higher level application functionality on top of websockets or websocket emulation via sockjs. Currently this module provides a token-based authentication mechanism, a publish-subscribe interface, and a bidirectional RPC interface. 

[The associated client library can be found here.](https://github.com/azuqua/jquery-token-sockjs)

# Install

	npm install node-token-sockjs

# API Overview

## Initialization

This module supports the following initialization parameters. All parameters are required unless stated otherwise.

* **app** - The express application used for HTTP routing.
* **prefix** - The route prefix that the sockjs server instance is bound to. The default value for this is "/sockets". This must match the client's configuration and the sockjs server instance configuration.
* **tokenRoute** - The route the client will use to attempt authentication. The default value for this is "/socket/token". This must match the client's configuration.
* **redisClient** - The redis client to use for non pub/sub commands.
* **pubsubClient** - Optional. The redis client to use for pub/sub commands.
* **socketServer** - The sockjs server instance this module should manage.
* **socketController** - Optional. An object, arbitrarily nested, mapping RPC function names to functions. See the RPC section for more details. This can be modified dynamically at any time following initialization by editing the server instance's "socketController" object.
* **customMiddleware** - Optional. Any custom middleware to apply to the token authentication route.
* **authentication** - The authentication mechanism used to determine if a socket will be issued a token. This property can be a string or object. If it's a string then the module will use the truthiness of the request's session property keyed by this string. For example, the default value for this property is "auth" which will use the truthiness of req.session.auth to decide if the socket should get a token. This property can also be a function which will be passed the request object and a callback. If the callback is called with a truthy second parameter the socket will be issued a token. If the second parameter is an object then this object will be attached to the socket. If the second parameter is not an object then the request's session object will be attached to the socket. See below for examples.
* **debug** - Optional. A boolean flag used to determine if the module should log relevant actions to the console.

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
	doSomething(req, function(error, result){
		if(error)
			callback(error); // socket will not be allowed to connect
		else if(result)
			callback(null, result); // socket will be issued a token and @result will be attached
		else 
			callback(null, true); // socket will be issued a token and req.session will be attached
	});
};

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

var tokenServer = new TokenSocketServer({
	app: app,
	prefix: socketOptions.prefix,
	tokenRoute: "/socket/token",
	redisClient: redisClient,
	pubsubClient: pubsubClient,
	socketServer: socketServer,
	socketController: controller,
	customMiddleware: customMiddleware,
	authentication: authenticationFn,
	debug: app.get("env") !== "production"
});

server.listen(process.env.PORT || 8000);
```

## RPC Interface

This module supports a bidirectional RPC interface between the server and client. This means the client can issue calls to the server and the server can issue calls to the client with a simple function call/callback interface. This can be very useful for syncing data between a distributed store on the server and any number of clients without relying on a big switch statement on top of a publish/subscribe pattern. The examples here will show how to use the RPC API surface from the server. See the [client docs](https://github.com/azuqua/jquery-token-sockjs) for examples of RPC functions going in the other direction.

```
// set up this server to accept RPC commands from the clients
// these functions can be created at initalization or dynamically later
// these examples will assume the tokenServer already exists and show how to dynamically modify RPC functions

tokenServer.socketController.ping = function(auth, data, callback, socket){
	// @auth is the data attached to the socket upon authentication
	// @data is the data provided by the client when issuing the RPC call
	// @callback is a function used to issue the final response to the client
	// @socket is an optional parameter that can be used to issue inner RPC calls, pub/sub operations, etc

	doSomethingAsync(data, function(error, result){
		if(error)
			callback(error);
		else
			callback(null, result);
	});

};

// issue an RPC command to the clients
var async = require("async");

async.each(tokenServer.sockets(), function(socket, callback){
	tokenServer.rpc(socket, "sayHello", { message: "hello" }, function(error, resp){
		console.log("Client says ", error, resp);
		callback(error);
	});
}, function(error){
	console.log("Done with client RPC calls", error);
});

```

## Events

Developers can hook into certain events as well. The server is extended by a generic EventEmitter so developers can attach multiple event listeners to any event. Event listeners related to publish - subscribe actions (subscribe, publish, unsubscribe, broadcast) can be used to enforce access control to certain actions. See below for examples. If multiple listener functions are bound to the same event only one of them needs to return a falsy value for the action to be disallowed.

* **authentication** - Fires when the socket successfully authenticates. The listener function will be called with the socket, authentication data, and a callback function. The callback function does not require any arguments.
* **subscribe** - Fires when a socket attempts to subscribe to a channel. The listener function will be called the socket, subscription data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from subscribing.
* **unsubscribe** - Fires when a socket attempts to unsubscribe from a channel. The listener function will be called with the socket, channel data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from unsubscribing.
* **publish** - Fires when a socket attempts to publish data on a channel. The listener function will be called with the socket, publish data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from publishing.
* **broadcast** - Fires when a socket attempts to broadcast data on all channels. The listener function will be called with the socket, broadcast data, and a callback function. Calling the callback function with an error or falsy second parameter will disallow the socket from broadcasting.

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
	console.log("Socket attempting to subscribe: ", data.channel);
	callback(null, true); // socket will be allowed to subscribe
});

tokenServer.on("publish", function(socket, data, callback){
	console.log("Socket attempting to publish: ", data.channel, data.data);
	callback(null, false); // socket will not be allowed to publish
});

// when multiple listeners are bound to an event only one of them need return an error or falsy value for the action to be disallowed
// in this example the broadcast action will be disallowed

tokenServer.on("broadcast", function(socket, data, callback){
	console.log("Socket attempting to broadcast: ", data.data);
	callback(null, true); 
});

tokenServer.on("broadcast", function(socket, data, callback){
	console.log("Socket attempting to broadcast: ", data.data);
	callback(null, false); 
});

// listener functions can be removed with removeListener and removeAllListeners

tokenServer.removeAllListeners("authentication");
```

## Cleanup

Sockjs does not support cookie based authentication or the passing of query parameters on a websocket HTTP upgrade request so it is not possible to entirely disallow a websocket connection. However, it is possible to force sockets to authenticate before they're allowed to do anything. If a socket does not identify itself within a certain amount of time it can be forced to disconnect. This module allows for setting a TTL on unauthenticated sockets in this manner.

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
});
```

# Publish - Subscribe Interface

Developers can also use the optional publish/subscribe interface by providing an additional redis client to the module's initialization parameters. 

TokenSocket clients can issue commands to subscribe themselves to channels or publish messages on a channel, however it is also possible for the server to modify socket channel subscriptions. 

## Publish a Message

Publishes a message on a channel.

```
tokenServer.publish("channel1", { foo: "bar" });
```

## Broadcast a Message

Broadcasts a message on all channels. If this is running in a distributed environment with a shared redis host this will broadcast the message on all channels, not just the channels that sockets connected to this server instance are subscribed to.

```
tokenServer.broadcast({ foo: "bar" });
```

## Subscribe a Socket to a Channel

```
var sockets = tokenServer.sockets();
sockets.forEach(function(socket){
	tokenServer.subscribe(socket, "channel1");
});
```

## Unsubscribe a Socket from a Channel

```
var sockets = tokenServer.sockets();
sockets.forEach(function(socket){
	tokenServer.unsubscribe(socket, "channel1");
});
```

## List Channels

List the channels that sockets connected to this server instance have subscribed to.

```
var channels = tokenServer.channels();
channels.forEach(function(channel){
	// maybe publish a message on all local channels
	tokenServer.publish(channel, { foo: "bar" });
});
```

## Shutdown

Shut down the server by closing all sockets and unsubscribing from all channels.

```
tokenServer.shutdown(); // note: this is synchronous
```

# Tests

This module uses Mocha/Chai for testing. In order to run the tests make sure a local redis server is running on port 6379.

```
npm install
grunt test
```
