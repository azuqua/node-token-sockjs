
var async        = require("async"),
    _            = require("lodash"),
    uuid         = require("node-uuid"),
    utils        = require("./utils"),
    ALL_CHANNEL  = "___all___",
    SYNC_CHANNEL = "___sync___",
    UUID_REGEXP  = /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/;

module.exports = function(options){
  var self = this;

  if(options.routes)
    self._routes = utils.expressRoutesToSocketActions(options.routes);

  var requestToken = function(req, res){
    async.waterfall([
      function(callback){
        self._debug("Sockjs token request received", req.params);
        if(typeof self.authentication === "function")
          self.authentication(req, callback); // use custom function with "req" as an argument
        else if(typeof self.authentication === "string")
          callback(null, req.session[self.authentication] ? true : false); // use custom session property  
        else
          callback(null, req.session && req.session.auth); // default
      }
    ], function(error, auth){
      var type = utils.requestType(req);
      if(error){
        self._debug("Error issuing token", error);
        res[type](500, { error: error.message || error });
      }else if(!auth){
        self._debug("Rejected token request");
        res[type](403, { error: "Forbidden" });
      }else{
        var save = typeof auth === "object" ? auth : _.merge({ __host: req.hostname || req.host, __ip: req.ip, __ips: req.ips }, (req.session || {}));
        utils.issueToken(self.redisClient, save, function(error, token){
          self._debug("Attaching token to authentication data", token, save);
          if(error)
            res[type](500, { error: error.message || error });
          else
            res[type](200, { token: token });
        });
      }
    });
  };

  if(options.customMiddleware && typeof options.customMiddleware === "function"){
    self._debug("Creating token route and attaching custom middleware");
    self.app.get(self.tokenRoute, options.customMiddleware, requestToken);
  }else{
    self._debug("Creating token route without custom middleware");
    self.app.get(self.tokenRoute, requestToken);
  }

  if(options.ping){
    self.socketController._ping = function(auth, data, callback, socket){
      self._debug("Socket sent ping", socket.sid);
      callback(null, { message: "pong" });
    };
  }

  if(self.pubsubClient){
    self._debug("Setting up publish-subscribe functionality");
    self.pubsubClient.subscribe(ALL_CHANNEL);
    self.pubsubClient.subscribe(SYNC_CHANNEL);
    self.pubsubClient.on("message", function(channel, message){
      if(channel === SYNC_CHANNEL){
        utils.handleInternal(self, message); 
      }else if(channel === ALL_CHANNEL){
        self._debug("Broadcasting message to all sockets on all channels", message);
        async.each(Object.keys(self._channels), function(_channel, callback){
          utils.writeSockets(self._channels[_channel], _channel, message, self._filter);
          callback();
        });
      }else{
        self._debug("Publish-subscribe message received", channel, message);
        if(self._channels[channel])
          utils.writeSockets(self._channels[channel], channel, message, self._filter);
      }
    });
  }

  self.socketServer.on("connection", function(socket){
    var sid = uuid.v4();
    self._debug("Socket connection initiated", sid);
    socket.sid = sid;
    socket.created = new Date().getTime();
    socket.channels = {};
    self._sockets[sid] = socket;

    socket.on("close", function(){
      self._debug("Socket connection closed", sid);
      if(self.pubsubClient && socket.channels){
        _.each(socket.channels, function(bool, channel){
          if(self._channels[channel]){
            delete self._channels[channel][socket.sid];
            if(Object.keys(self._channels[channel]).length === 0){
              self.pubsubClient.unsubscribe(channel);
              delete self._channels[channel];
            }
          }
        });
      }
      delete self._sockets[sid];
    });

    socket.on("data", function(message){
      try{
        message = JSON.parse(message);
      }catch(e){
        return socket.write(JSON.stringify({ error: "Invalid message" }));
      }
      self._debug("Socket message received", message);

      var sendMessage = function(error, resp){
        if(error)
          message.error = error.message || error;
        else
          message.resp = resp;
        self._debug("Writing message on socket", socket.sid, message);
        socket.write(JSON.stringify(message));
      };

      if(message.rpc === "auth" && message.token){
        self._debug("Socket auth request received", socket.sid, message.token);
        if(!message.token.match(UUID_REGEXP)){
          delete self._sockets[socket.sid];
          return socket.end();
        }
        utils.verifyToken(self.redisClient, message.token, function(error, data){
          if(error || !data){
            self._debug("Error verifying token", socket.sid, message.token, error);
            sendMessage(error.message || error || "Invalid token");
            delete self._sockets[socket.sid];
            socket.end();
          }else{
            self._debug("Successfully verified token", message.token, data);
            socket.auth = data;
            socket.host = data.__host;
            socket.ip = data.__ip;
            socket.ips = data.__ips;
            delete socket.auth.__ip;
            delete socket.auth.__ips;
            delete socket.auth.__host;
            utils.revokeToken(self.redisClient, message.token, function(err){
              if(err)
                self._debug("Error revoking token!", socket.sid, message.token, err);
            });
            utils.checkListeners(self._emitter, "authentication", socket, socket.auth, function(){
              sendMessage(null, "success");
            });
          }
        });
      }else if(!socket.auth){
        self._debug("Socket attempting to perform action before authorizing. Ending connection.", socket.sid, message);
        message.error = "Forbidden";
        socket.write(JSON.stringify(message));
        socket.end();
        delete self._sockets[socket.sid];
      }else{
        self._rpc(socket, message, sendMessage);
      }
    });
  });

};