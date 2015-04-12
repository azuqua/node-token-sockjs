
var async       = require("async"),
    _           = require("lodash"),
    uuid        = require("node-uuid"),
    ALL_CHANNEL = "___all___",
    SYNC_CHANNEL = "___sync___",
    utils       = require("./utils");

module.exports = {
  
  on: function(event, callback){
    this._emitter.on(event, callback);
  },
  
  removeListener: function(event, listener){
    this._emitter.removeListener(event, listener);
  },
  
  removeAllListeners: function(event){
    this._emitter.removeAllListeners(event);
  },

  publishFilter: function(callback){
    this._filter = callback;
  },

  rpc: function(socket, command, args, callback){
    var fid = uuid.v4();
    this._inTransit[fid] = callback;
    socket.write(JSON.stringify({
      internal: true,
      command: "rpc",
      data: {
        fid: fid,
        command: command,
        args: args
      }
    }));
  },

  enableCleanup: function(interval){
    this._debug("Enabling cleanup process");
    this._cleanup = typeof interval === "number" ? interval : 5000;
    if(this._cleanupTimer)
      clearInterval(this._cleanupTimer);
    if(!(this._cleanupFn && typeof this._cleanupFn === "function")){
      this._cleanupFn = function(instance){
        instance._debug("Running cleanup process");
        var diff = new Date().getTime() - instance._cleanup,
            deleted = [];
        // cleanup sockets
        async.each(instance.sockets(), function(socket, callback){
          if(!socket.auth && socket.created && socket.created < diff){
            instance._debug("Cleaning up socket", socket.sid);
            deleted.push(socket.sid);
            socket.end();
            delete instance._sockets[socket.sid];
          }
          callback();
        }, function(){
          // cleanup channels
          if(instance.pubsubClient){  
            async.each(deleted, function(sid, callback){
              _.each(deleted.channels, function(bool, channel){
                delete instance._channels[channel][sid];
                if(Object.keys(instance._channels[channel]).length === 0){
                  instance.pubsubClient.unsubscribe(channel);
                  delete instance._channels[channel];
                }
              });
              callback();
            });
          }
        });
      };
    }
    this._cleanupTimer = setInterval(this._cleanupFn, this._cleanup, this);
  },

  disableCleanup: function(){
    this._debug("Disabling cleanup");
    this._cleanup = null;
    if(this._cleanupTimer)
      clearInterval(this._cleanupTimer);
  },

  subscribe: function(socket, channel){
    if(this.pubsubClient){
      this._debug("Subscribing socket", socket.sid, channel);
      if(!this._channels[channel]){
        this.pubsubClient.subscribe(channel);
        this._channels[channel] = {};
      }
      this._channels[channel][socket.sid] = socket;
      if(!socket.channels)
        socket.channels = {};
      socket.channels[channel] = true;
      utils.sync(socket, "subscribe", { channel: channel });
    }
  },

  unsubscribe: function(socket, channel){
    if(this.pubsubClient && socket && channel){
      this._debug("Unsubscribing socket", socket.sid, channel);
      if(socket.channels && socket.channels[channel])
        delete socket.channels[channel];
      if(this._channels[channel]){
        delete this._channels[channel][socket.sid];
        if(Object.keys(this._channels[channel]).length === 0){
          this.pubsubClient.unsubscribe(channel);
          delete this._channels[channel];
        }
      }
      utils.sync(socket, "unsubscribe", { channel: channel });
    }
  },

  unsubscribeAll: function(channel){
    if(this.pubsubClient && channel){
      this._debug("Unsubscribing all sockets from channel", channel);
      this.redisClient.publish(SYNC_CHANNEL, JSON.stringify({
        command: "unsubscribeAll",
        data: { channel: channel }
      }));
    }
  },

  publish: function(channel, data){
    if(this.pubsubClient){
      this._debug("Publishing message", channel, data);
      this.redisClient.publish(channel, typeof data === "object" ? JSON.stringify(data) : data);
    }
  },

  broadcast: function(data){
    if(this.pubsubClient){
      this._debug("Broadcasting message", data);
      this.redisClient.publish(ALL_CHANNEL, typeof data === "object" ? JSON.stringify(data) : data);
    }
  },

  channels: function(){
    return Object.keys(this._channels);
  },

  sockets: function(){
    return _.values(this._sockets);
  },

  channelSockets: function(channel){
    return _.values(this._channels[channel] ? this.channels[channel] : {});
  },

  shutdown: function(){
    this._debug("Shutting down server...");
    if(this.app.routes && this.app.routes.get){
      this.app.routes.get = _.filter(this.app.routes.get, function(route){
        return route.path !== this.tokenRoute;
      }.bind(this));
      this._debug("Removed token route");
    }
    _.each(this._sockets, function(socket){
      socket.end();
    });
    this._debug("Closed all sockets");
    this._sockets = {};
    if(this.pubsubClient){
      _.each(this._channels, function(sockets, channel){
        delete this._channels[channel];
        this.pubsubClient.unsubscribe(channel);
      }.bind(this));
      this._debug("Unsubscribed from all channels");
    }
  }

};