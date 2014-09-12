
var async = require("async"),
	_ = require("underscore"),
	EventEmitter = require("events").EventEmitter,
	uuid = require("node-uuid");

module.exports = {

	checkController: function(controller, path){
		var i, parts = path.split("."),
			curr = controller;
		for(i = 0; i < parts.length; i++){
			if(typeof curr[parts[i]] === "object")
				curr = curr[parts[i]];
			else if(typeof curr[parts[i]] === "function")
				return curr[parts[i]];
			else	
				break;
		}
		return null;
	},	

	checkListeners: function(emitter, event, socket, message, callback){
		var todo = EventEmitter.listenerCount(emitter, event);
		if(todo > 0){
			var allowed = true,
				done = false;
			var testFn = function(error, out){
				todo--;
				if(!done && error || !out){
					allowed = false;
					done = true;
					callback(error, allowed);
				}else if(!done){
					done = todo === 0;
					allowed = out ? true : false;
					if(done)
						callback(null, allowed);
				}
			};
			emitter.emit(event, socket, message.req, testFn);
		}else{
			process.nextTick(function(){
				callback(null, true);
			});
		}
	},

	issueToken: function(client, data, callback){
		var token = uuid.v4();
		if(typeof data === "object")
			data = JSON.stringify(data);
		client.set(token, data, function(error, resp){
			if(error)
				callback(error);
			else
				callback(null, token);
		});
	},

	verifyToken: function(client, token, callback){
		if(token){
			client.get(token, function(error, resp){
				if(error || !resp)
					callback(error || new Error("Token not found"));
				else
					callback(null, JSON.parse(resp));
			});
		}else{
			callback(new Error("No token provided"));
		}
	},

	revokeToken: function(client, token, callback){
		client.del(token, function(error, resp){
			if(error)
				callback(error);
			else
				callback(null, true);
		});
	},

	requestType: function(req){
		return req.param("callback") ? "jsonp" : "json";
	},

	sync: function(socket, command, data){
		var out = {
			internal: true,
			command: command,
			data: data
		};
		socket.write(JSON.stringify(out));
	},

	writeSockets: function(sockets, channel, message){
		var out = { channel: channel };
		try{
			message = JSON.parse(message);
			out.message = message;
		}catch(e){
			out.message = message;
		}
		out = JSON.stringify(out);
		async.each(Object.keys(sockets), function(sid, callback){
			sockets[sid].write(out);
			callback();
		});
	}

};

