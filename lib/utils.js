
var async = require("async"),
	uuid = require("node-uuid");

module.exports = {

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
	}

};

