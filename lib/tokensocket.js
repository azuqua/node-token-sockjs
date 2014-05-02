
var async = require("async"),
	_ = require("underscore"),
	uuid = require("node-uuid"),
	utils = require("./utils");


var TokenSocketServer = function(options){
	var self = this;
	self.app = options.app;
	self.prefix = options.prefix || "/sockets";
	self.tokenRoute = options.tokenRoute || "/socket/token";
	self.redisClient = options.redisClient;
	self.socketServer = options.socketServer;
	self.socketController = options.socketController;
	self.cleanup = options.cleanup;
	self.channels = {};
	self.sockets = {};
	self.events = {};
 
	// create the token route
	var requestToken = function(req, res){
		async.waterfall([
			function(callback){
				if(typeof options.authentication === "function")
					options.authentication(req, callback); // use custom function with "req" as a parameter
				else if(typeof options.authentication === "string")
					callback(null, req.session[options.authentication]); // use custom session property	
				else
					callback(null, req.session.auth); // default
			}
		], function(error, auth){
			var type = utils.requestType(req);
			if(error){
				res[type](500, { error: error.message || error });
			}else if(!auth){
				res[type](400, { error: "Unauthorized" });
			}else{
				// issue a token
				utils.issueToken(self.redisClient, req.session, function(error, token){
					if(error)
						res[type](500, { error: error.message || error });
					else
						res[type](200, { token: token });
				});
			}
		});
	};

	if(options.customMiddleware)
		self.app.get(self.tokenRoute, options.customMiddleware, requestToken);
	else
		self.app.get(self.tokenRoute, requestToken);

	if(options.pubsubClient){
		self.pubsubClient = options.pubsubClient;
		self.pubsubClient.on("message", function(channel, message){
			var out = { channel: channel };
			try{
				message = JSON.parse(message);
				out.message = message;
			}catch(e){
				out.message = message;
			}
			out = JSON.stringify(out);
			if(self.channels[channel]){
				async.each(Object.keys(self.channels[channel]), function(sid, callback){
					self.channels[channel][sid].write(out);
				});
			}
		});
	}

	if(self.cleanup)
		self.startCleanup();

	self.socketServer.on("connection", function(socket){
		var sid = uuid.v4();
		socket.sid = sid;
		socket.created = new Date();
		sockets[sid] = socket;
		socket.on("close", function(){
			delete self.sockets[sid];
			if(self.pubsubClient && socket.channels){
				_.each(socket.channels, function(channel){
					delete self.channels[channel][socket.sid];
					if(Object.keys(self.channels[channel]).length === 0)
						self.pubsubClient.unsubscribe(channel);
				});
			}
		});

		socket.on("data", function(message){
			try{
				message = JSON.parse(message);
			}catch(e){
				return socket.write(JSON.stringify({ error: "Invalid message" }));
			}

			var sendMessage = function(error, resp){
				if(error)
					message.error = error.message || error;
				else
					message.resp = resp;
				socket.write(JSON.stringify(message));
			};

			if(message.rpc === "auth" && message.token){
				if(!message.token.match(/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/i)){
					socket.end();
					delete self.sockets[socket.id];
					return;
				}
				utils.verifyToken(self.redisClient, message.token, function(error, data){
					if(error){
						sendMessage(error.message || error);
						delete self.sockets[socket.sid];
						socket.end();
					}else{
						socket.auth = true;
						sendMessage(null, "success");
						// only allow tokens to work once
						revokeToken(message.token, function(err){
							if(err)
								throw err;
						});
					}
				});
			}else if(!socket.auth){
				message.error = "Not authorized";
				socket.write(JSON.stringify(message));
				socket.end();
				delete self.sockets[socket.sid];
			}else{
				// check pub sub commands
				if(message.rpc && message.rpc === "_subscribe"){
					self.subscribe(socket, message.req.channel);
				}else if(message.rpc && message.rpc === "_publish"){
					self.publish(message.req.channel, message.req.data);
				}else if(message.rpc && message.rpc === "_unsubscribe"){
					self.unsubscribe(socket, message.req.channel);
				}else if(message.rpc && message.rpc === "_broadcast"){
					self.broadcast(message.req.data);
				}else if(message.rpc && self.socketController[message.rpc]){
					// proxy the socket controller
					self.socketController[message.rpc](message.req, sendMessage);
				}else{
					sendMessage("Invalid request");
				}
			}
		});
	});

	process.on("exit", function(){
		self.redisClient.quit();
		self.pubsubClient.quit();
	});

};

TokenSocketServer.prototype.enableCleanup = function(interval){
	this.cleanup = typeof interval === "number" ? interval : 5000;
	if(this.cleanupTimer)
		clearInterval(this.cleanupTimer);
	if(!(this.cleanupFn && typeof this.cleanupFn === "function")){
		this.cleanupFn = function(instance){
			var now = new Date();
			var diff = now - instance.cleanup;
			var deleted = [];
			// cleanup sockets
			async.each(instance.sockets || [], function(socket, callback){
				if(!socket.auth && socket.created && socket.created < diff){
					deleted.push(socket.sid);
					socket.end();
					delete instance.sockets[socket.sid];
				}
				callback();
			}, function(){
				// cleanup channels
				if(instance.pubsubClient){	
					async.each(Object.keys(instance.channels), function(channel, callback){
						async.each(deleted, function(sid, cb){
							delete instance.channels[channel][sid];
							cb();
						}, callback);
					});
				}
			});
		};
	}
	this.cleanupTimer = setInterval(this.cleanupFn, this.cleanup, this);
};

TokenSocketServer.prototype.disableCleanup = function(){
	this.cleanup = null;
	if(this.cleanupTimer)
		clearInterval(this.cleanupTimer);
};

TokenSocketServer.prototype.subscribe = function(socket, channel){
	if(this.pubsubClient){
		if(!this.channels[channel]){
			this.pubsubClient.subscribe(channel);
			this.channels[channel] = {};
		}
		this.channels[channel][socket.sid] = socket;
		if(!socket.channels)
			socket.channels = {};
		socket.channels[channel] = true;
	}
};

TokenSocketServer.prototype.unsubscribe = function(socket, channel){
	if(this.pubsubClient){
		delete socket.channels[channel];
		delete this.channels[channel][socket.sid];
		if(Object.keys(this.channels[channel]).length === 0)
			this.pubsubClient.unsubscribe(channel);
	}
};

TokenSocketServer.prototype.sockets = function(){
	var self = this;
	return _.map(Object.keys(self.sockets), function(sid){
		return self.sockets[sid];
	});
};

TokenSocketServer.prototype.channels = function(){
	return Object.keys(this.channels);
};

// publish a message on a channel
TokenSocketServer.prototype.publish = function(channel, data){
	if(this.pubsubClient)
		this.pubsubClient.publish(channel, typeof data === "object" ? JSON.stringify(data) : data);
};

// publish a message on all channels
TokenSocketServer.prototype.broadcast = function(data){
	if(this.pubsubClient){
		var self = this;
		if(typeof data === "object")
			data = JSON.stringify(data);
		async.each(Object.keys(self.channels), function(channel, callback){
			self.pubsubClient.publish(channel, data);
		});
	}
};

// remove all sockets and channels
TokenSocketServer.prototype.shutdown = function(){
	var self = this;
	_.each(self.sockets, function(socket, sid){
		socket.end();
	});
	self.sockets = {};
	if(self.pubsubClient){
		_.each(self.channels, function(sockets, channel){
			self.pubsubClient.unsubscribe(channel);
		});
	}
};


module.exports = TokenSocketServer;

