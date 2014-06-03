/**
 * Class File: app
 * Created by Adrian on 02-Jun-14.
 */
var blaster = require('./lib/index.js'),
	proxyServer = new blaster.proxy();

proxyServer.configure('development', {
	port: 10000,
	//sticky_session: true
}).bind();

proxyServer.on('node.register', function(nodeObj) {
	console.log('register', nodeObj.id);
}).on('node.timeout', function(nodeObj) {
	console.log('TIMEOUT', nodeObj.id);
}).on('node.ping', function(nodeObj) {
//	console.log('Ping from ',nodeObj.id)
}).on('node.unregister', function(nodeObj) {
	console.log('unreg', nodeObj.id)
}).on('node.error', function(nodeObj, err) {
	console.log('nerr')
}).on('cluster.full', function() {
	console.log("CLUSTER FULL");
}).on('cluster.normal', function() {
	console.log('CLUSTER normal now.');
}).on('cluster.warning', function(p) {
	console.log('warning', p)
}).on('redirect', function(nodeObj) {
	console.log('redirected to ', nodeObj.id);
})