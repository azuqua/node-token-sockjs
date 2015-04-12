
var _ = require("lodash"),
	utils = require("../../lib/utils");

module.exports = function(TokenSocketServer){

	describe("External exports tests", function(){

		var serverFunctions = [
			"on",
			"removeListener",
			"removeAllListeners",
			"rpc",
			"enableCleanup",
			"disableCleanup",
			"subscribe",
			"unsubscribe",
			"unsubscribeAll",
			"publish",
			"broadcast",
			"channels",
			"sockets",
			"channelSockets",
			"shutdown"
		];

		var utilFunctions = [
			"debug",
			"checkController",
			"checkListeners",
			"issueToken",
			"verifyToken",
			"revokeToken",
			"requestType",
			"sync",
			"writeSockets"
		];

		it("Should export the correct set of functions on the prototype", function(){
			_.each(serverFunctions, function(fn){
				assert.isFunction(TokenSocketServer.prototype[fn], "Socket server exports: " + fn);
			});
		});

		it("Should export the correct set of functions within utils", function(){
			_.each(utilFunctions, function(fn){
				assert.isFunction(utils[fn], "Utils exports: " + fn);
			});
		});

	});

};