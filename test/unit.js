

module.exports = function(TokenSocketServer){

	describe("Unit tests", function(){

		require("./unit/setup.js")(TokenSocketServer);
		require("./unit/external.js")(TokenSocketServer);

	});

};