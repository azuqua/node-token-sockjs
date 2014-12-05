
module.exports = function(TokenSocketServer){

  var express = require("express"),
      sockjs = require("sockjs"),
      redis = require("redis"),
      RestJS = require("restjs"),
      TokenSocket = require("token-sockjs-client"),
      http = require("http");

  if(typeof RestJS === "object" && RestJS.Rest)
    RestJS = RestJS.Rest;

  var httpClient = new RestJS({ protocol: "http" });

  var redisHost = process.env.REDIS_HOST || "127.0.0.1",
      redisPort = process.env.REDIS_PORT || 6379;

  var redisClient = redis.createClient(redisPort, redisHost),
      pubsubClient = redis.createClient(redisPort, redisHost);

  var app = express(),
      socketServer = sockjs.createServer();

  var server = http.createServer(app),
      port = process.env.PORT || 6072;

  socketServer.installHandlers(server, {
    prefix: "/sockets",
    sockjs_url: "//cdn.sockjs.org/sockjs-0.3.min.js"
  });

  var tokenServer = new TokenSocketServer(app, redisClient, socketServer, {
    pubsubClient: pubsubClient,
    socketController: {
      echo: function(auth, data, callback){
        callback(null, data);
      }
    },
    authentication: function(req, callback){
      callback(null, req.param("allow"));
    }
  });

  describe("Integration tests", function(){

    before(function(done){
      server.listen(port, done);
    });

    after(function(){
      tokenServer.shutdown();
    });

    var options = {
      host: "127.0.0.1",
      port: port,
      authentication: {
        allow: 1
      }
    };

    require("./integration/authentication")(tokenServer, httpClient, TokenSocket, options);
    require("./integration/rpc")(tokenServer, httpClient, TokenSocket, options);
    require("./integration/pubsub")(tokenServer, httpClient, TokenSocket, options);

  });

};