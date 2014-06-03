/*
* This is a test BlastNodeServer
* */
var http = require('http'),
	blaster = require('./lib/index.js');

for(var i=0; i < 4; i++) {
	(function(_port) {
		var blasterNode = new blaster.node();
		blasterNode.configure({
			node: {
				port: _port,
				connections: 100
			}
		}).register(function(err) {
			console.log('ok')
		}).on('error', function(e) {
			console.log(e);
		});

		http.createServer(function(req, res){
			console.log('requyest', _port);
			res.write("HI + "+ _port);
			res.end();
		}).listen(_port, function() {
			console.log('Listening on ' + _port);
		});
	})(i + 5000);
}
