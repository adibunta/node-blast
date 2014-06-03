/*
 * A Proxy component is a wrapper over a HTTP server that will forward all requests to a given registered node.
 * */

var BlastConfig = require('./../core/configuration.js'),
	util = require('util'),
	BlastCluster = require('./cluster.js'),
	request = require('request'),
	http = require('http'),
	EventEmitter = require('events').EventEmitter;

var DEFAULTS = {
	hostname: 'localhost',	/* The hostname of the proxy server */
	ip: '0.0.0.0',			/* The IP we want to bind the proxy to */
	port: 3000,				/* The port to listen to */
	timeout: 1000,			/* The default timeout for a request to a node, until declaring that node as dead. */
	sticky_session: false,	/* When we want a user to connect to the same node, we set this to true. */
	cookie: 'nblast',		/* The cookie name we want to send back to the user. This is used together with sticky_session=true */
	cluster: {
		ip: '0.0.0.0',			/* The IP that will be used to listen for incoming node registrations. Defaults to all interfaces*/
		port: 18755,			/* The port that will be used by all nodes to register in the cluster */
		key: null,				/* If specified, the authentication key that all nodes must provide to register in the cluster */
		timeout: 3,				/* The maximum number of seconds between node ping, until we mark it offline. This should be higher than the node's internal timer */
		fails: 2,				/* The number of time a node is allowed to miss a ping, after which it is removed. */
		supervisor: 2,			/* The number of seconds between supervisor checks for the cluster. The supervisor will check the connection count of all the nodes and reset them accordingly. Defaults to 1min */
		critical: 90			/* The percentage of connections which we consider to be critical, In this case, the cluster is not full, nor empty, but it has 90% active connections, so we're concerned. */
	}
};

/*
 * A complete list of events that the proxy will fire:
 *
 * 	error(err) - when an error occurs.
 * 	unavailable(req, res) -
 * 	redirect(nodeObj) - whenever a user connects and it is redirected, this event will be fired, along with the node to which he was redirected
 *	node.register(nodeObj) - event is fired whenever a node announces its presence in the cluster
 *	node.unregister(nodeObj) - event is fired whenever a node unregisteres from the cluster
 *	node.timeout(nodeObj) - event is fired whenever a request to a node timeouts. When this happends, the node is marked as offline.
 *	node.ping(nodeObj)
 *	node.error(nodeObj, err)
 *	cluster.full	- event is fired when all the nodes have achieved their maximum connection count.
 *	cluster.normal	- after a cluster.full event, when the load drops, this event is fired.
 *	cluster.warning(percentage)	- If the connection count for all the nodes is over 90%, this event is fired.
 * */

var proxy = function BlastProxy() {
	this.config = new BlastConfig(DEFAULTS);
	this.cluster = new BlastCluster(this);
	this.server = null;			/* The HTTP Server */
	EventEmitter.call(this);
	this.setMaxListeners(100);
};
util.inherits(proxy, EventEmitter);

/*
 * Configures the proxy with a given configuration for a given environment. If no environment is given, 'development' will be used.
 * Arguments:
 * 	_env - string, the environment we want to use
 * 	_data - object, the configuration data we want to use for the given environment
 * */
proxy.prototype.configure = function Configure(_env, _data) {
	var env = (typeof _env == 'string' ? _env : 'development'),
		data = (typeof _data == 'object' && _data != null ? _data : {});
	this.config.setData(env, data);
	return this;
};

/*
 * Binds the proxy server and starts listening for connections.
 * Note: if a HTTP server object is given, it will use it rather than creating its own server
 * Arguments:
 * 		_environment - optional, the environment we want to use. If not specified, we will use the one used in configure()
 * 		_server - optional, the HTTP Server object we want to use. If provided, it must be binded.
 * 		_callback - optional, the callback to call when we're binded.
 *
 * */
proxy.prototype.bind = function Bind(_environment, _server, _callback) {
	var environment = (typeof _environment == 'string' ? _environment : null),
		callback = ((typeof _environment == 'function' ? _environment : typeof _server == 'function' ? _server : (typeof _callback == 'function' ? _callback : null))),
		server = (typeof _environment == 'object' && _environment != null ? _environment : (typeof _server == 'object' && _server != null ? _server : null)),
		self = this;
	if(environment != null) this.config.__env = environment;
	if(server != null) {
		this.server = server;
		self.cluster.bind(callback);
	} else {
		this.server = http.createServer().listen(this.config.get().port,this.config.get().ip, function() {
			log.trace('Proxy server listening on port: %s', self.config.get().port);
			self.cluster.bind(callback);
		});
	}
	this.server.on('request', function(req, res) {
		self.handle(req, res);
	}).on('upgrade', function(req, socket, head) {

	});
	return this;
};

/*
 * Handles a HTTP Request. It will try and select a node for it. If by any chance no node is available, we trigger
 * the 'unavailable' event. If anyone was subscribed to that event, we will forward both the request and the response to it
 * for custom message displaying and such, therefore we will NOT close the connection. If no subscriber for that event is registered,
 * we will send a 503 Service unavailable content.
 * */
proxy.prototype.handle = function HandleRequest(req, res) {
	var nodeObj = this.cluster.selectNode(req);
	if(nodeObj == null) {/* If there is no node available, we display 503 */
		if(this.listeners("unavailable").length == 0) {
			return this.__serviceUnavailable(res);
		}
		return this.emit('unavailable', req, res);
	}
	if(this.config.get().sticky_session) {
		res.setHeader('Set-Cookie', this.config.get().cookie + '=' + nodeObj.id);
	}
	this.proxyRequest(req, res, nodeObj);
};

/*
* Proxies the given req/res pair to the given node object. If the proxy fails, then
* it will select a diferent node.
* */
proxy.prototype.proxyRequest = function ProxyRequest(req, res, nodeObj) {
	var self = this;
	var proxyReq = http.request({
		host: nodeObj.config.hostname,
		port: nodeObj.config.port,
		method: req.method,
		path: req.url,
		headers: req.headers
	}, function(proxyRes) {
		proxyRes.on('data', function(chunk) {
			res.write(chunk, 'binary');
		}).on('end', function() {
			res.end();
		}).on('error', function(err) {
			self.__onError(req, res, nodeObj, err);
		});
	});
	proxyReq.on('socket', function (socket) {
		socket.setTimeout(self.config.get().cluster.timeout * 1000);
		socket.on('timeout', function() {
			proxyReq.abort();
			self.__onError(req, res, nodeObj, new Error('SOCKET_TIMEOUT'));
		});
	});
	proxyReq.on('error', function(err) {
		self.__onError(req, res, nodeObj, err);
	});
	req.on('data', function(chunk) {
		proxyReq.write(chunk, 'binary');
	}).on('end', function() {
		nodeObj.redirects++;
		if(self.listeners("redirect").length != 0) {
			self.emit('redirect', nodeObj);
		}
		proxyReq.end();
	}).on('error', function(err) {
		/* If we encounter an error, we mark it as offline. */
		self.__onError(req, res, nodeObj, err);
	});
};
/*
* Handles a proxy request's onError
* */
proxy.prototype.__onError = function OnError(req, res, nodeObj, err) {
	nodeObj.online = false;
	this.emit('node.error', nodeObj, err);
	this.handle(req, res);
};


/*
 * The function will return a 503: Service unavailable to a given response.
 * */
proxy.prototype.__serviceUnavailable = function ServiceUnavailable(res) {
	res.statusCode = 503;
	res.setHeader('Content-Type', "text/html");
	var html = "" +
		"<html>" +
		"<head>" +
		"<title>Error 503 - Service Unavailable</title>" +
		"</head>" +
		"<body>" +
		"<br />" +
		"<h1 style='text-align: center'>503 Service Unavailable</h1>" +
		"<hr />" +
		"<center>" +
		"NodeBlast/0.0.1" +
		"</center>" +
		"</body>" +
		"</html>";
	res.write(html);
	res.end();
};

module.exports = proxy;