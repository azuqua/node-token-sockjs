

module.exports = function(TokenSocketServer){

	require("./unit/setup.js")(TokenSocketServer);
	require("./unit/external.js")(TokenSocketServer);
	require("./unit/server.js")(TokenSocketServer);
	require("./unit/rpc.js")(TokenSocketServer);

};