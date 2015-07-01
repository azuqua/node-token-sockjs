
var async        = require("async"),
    _            = require("lodash"),
    EventEmitter = require("events").EventEmitter,
    uuid         = require("node-uuid"),
    TOKEN_TTL    = 30; // seconds

var extendError = function(e){
  return _.extend({ message: e.message }, e);
};
    
module.exports = {

  handleInternal: function(self, message){
    try{
      message = JSON.parse(message);
    }catch(e){
      return self._debug("Error parsing internal message!", message);
    }
    switch(message.command){
      case "unsubscribeAll": 
        if(!message.data || !message.data.channel)
          break;
        _.each(self._channels[message.data.channel], function(socket){
          self.unsubscribe(socket, message.data.channel);
        });
        break;
    } 
  },

  expressRoutesToSocketActions: function(controllers){
    var expressMapping = function(fn, auth, data, callback, socket){
      fn.apply(fn, module.exports.socketToExpressArgs(auth, data, callback, socket));
    };
    var mapFunctions = function(store, child){
      _.each(child, function(val, key){
        if(key === "socket" || key === "public") return;
        
        if(typeof val === "object")
          store[key] = mapFunctions({}, val);
        else if(typeof val === "function")
          store[key] = expressMapping.bind({}, val);
      });
      return store;
    };
    return mapFunctions({}, controllers);
  },

  socketToExpressArgs: function(auth, data, callback, socket){
    var req = {}, res = {};
    _.extend(req, {
      _socket: socket,
      body: data,
      query: data,
      params: data,
      subdomains: [],
      cookies: {},
      route: "/",
      host: socket.host,
      hostname: socket.host,
      ip: socket.ip,
      ips: socket.ips,
      fresh: true,
      stale: false,
      xhr: false,
      protocol: "ws",
      method: "post",
      originalUrl: "/",
      headers: { 
        "content-type": "application/json",
        "accepts": "application/json"
      },
      param: function(name){
        return req.params[name];
      },
      accepts: function(names){
        return names instanceof Array && names.length === 1 && names.indexOf(req.headers.accepts) === 0 ? true : names === req.headers.accepts;
      },
      is: function(type){
        return [{ value: "application/json", quality: 1, type: "application", subtype: "json" }];
      },
      get: function(name){
        return req.headers[name.toLowerCase()];
      },
      user: auth,
      session: auth
    });
    _.extend(res, {
      _headers: {
        "content-type": "application/json"
      },
      json: function(code, data){
        if(typeof data === "undefined" && code){
          data = code;
          code = 200;
        }
        code = res.statusCode ? res.statusCode : code;
        _.extend(data, { 
          _headers: res._headers, 
          _code: code 
        });
        callback(code < 300 ? null : (data.error || data), code < 300 ? data : null);
      },
      end: res.json,
      status: function(code){
        res.statusCode = code;
        return res;
      },
      set: function(key, val){
        if(typeof val === "undefined" && typeof key === "object")
          res._headers = key;
        else
          res._headers[key.toLowerCase()] = val;
      },
      get: function(key){
        return res._headers[key.toLowerCase()];
      }
    });
    return [req, res];
  },

  debug: function(){
    if(this.debug){
      var args = Array.prototype.slice.call(arguments);
      args.unshift("Node Token Server: ");
      this.log.apply(this.log, args);
    }
  },

  checkController: function(){
    var args = Array.prototype.slice.call(arguments);
    var controller = _.reduce(args.slice(0, args.length - 1), function(memo, obj){
      return _.merge(memo, obj);
    }, {});
    var path = args[args.length - 1];
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
      emitter.emit(event, socket, message.req || message, testFn);
    }else{
      process.nextTick(function(){
        callback(null, true);
      });
    }
  },

  issueToken: function(client, data, callback){
    var token = uuid.v4();
    client.setex(token, TOKEN_TTL, typeof data === "object" ? JSON.stringify(data) : data, function(error, resp){
      callback(error, token);
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

  writeSockets: function(sockets, channel, message, filter){
    var out = { channel: channel };
    try{
      message = typeof message === "string" ? JSON.parse(message) : message;
      out.message = message;
    }catch(e){
      out.message = message;
    }finally{
      out = JSON.stringify(out);
      async.each(Object.keys(sockets), function(sid, callback){
        var filtered = null;
        if(filter && typeof filter === "function"){
          filtered = filter(sockets[sid], channel, message);
          if(!filtered)
            return callback();
          out = JSON.stringify({ 
            channel: channel, 
            message: filtered
          });
        }
        sockets[sid].write(out);
        callback();
      });
    }
  },

  serializeError: function(error){
    if(typeof error !== "object")
      return error;

    return error instanceof Array ? _.map(error, extendError) : extendError(error);
  }

};

