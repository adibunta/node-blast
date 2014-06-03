var BlastNode = require('./node.js'),
	qs = require('querystring'),
	url = require('url'),
	http = require('http');
/*
* This is the proxy cluster. It takes care of node registration and timeouts.
* */

var cluster = function BlastCluster(_proxy) {
	this.proxy = _proxy;
	this.server = null;	/* The HTTP server for node registration. */
	this.nodes = [];	/* An array of active blast nodes */
	this.current_idx = 0;	/* The current node's index. */
	this.__interval = {
		redirect: null	/* Contains the setInterval of the cluster supervisor, which resets the connection count every min for all */
	};
};

/*
 * The function will select a given node to redirect the user to. If sticky session is enabled, we will try and redirect him
 * to that node, if not, we will select another node. If no node is available, we will return null;
 * */
cluster.prototype.selectNode = function SelectNode(req) {
	if(this.nodes.length == 0) return null;
	var nodeObj = null;
	if(req.headers.cookie && req.headers.cookie.length) {
		try {
			var cookieIdx = req.headers.cookie.indexOf(this.proxy.config.get().cookie + '=');
			if(cookieIdx != -1) {
				var full = req.headers.cookie,
					cookie = full.substr(cookieIdx + this.proxy.config.get().cookie.length, full.length),
					nodeId;
				if(cookie.indexOf(';') == -1) {
					nodeId = cookie;
				} else {
					nodeId = cookie.substr(0, cookie.indexOf(';')-1);
				}
				nodeId = nodeId.replace('=','');
				var nodeObj = this.getNode(nodeId);
			}
		} catch(e) {}
	}
	if(nodeObj == null || !nodeObj.canRedirect()) {
		if(this.current_idx >= this.nodes.length) this.current_idx = 0;
		for(var i=this.current_idx; i < this.nodes.length; i++) {
			if(this.nodes[i].canRedirect()) {
				this.current_idx++;
				return this.nodes[i];
			}
		}
	}
	return null;
};

/*
* Returns a node by its id, or null if not found.
* */
cluster.prototype.getNode = function GetNode(id) {
	for(var i=0; i < this.nodes.length; i++) {
		if(this.nodes[i].id == id) return this.nodes[i];
	}
	return null;
};


/*
* Binds the Registration cluster so that other nodes can register to it.
* */
cluster.prototype.bind = function BindCluster(_callback) {
	var _config = this.proxy.config.get().cluster,
		self = this;
	var onProcess = function OnProcess(req, res) {
		if(req.path == '/register') {
			return self.handleRegister(req, res);
		}
		if(req.path == '/ping') {
			return self.handlePing(req, res);
		}
		self.send(res, 'error', 'Invalid request.');
		return res.end();
	};
	var onRequest = function(req, res) {
		req.body = {};
		req.path = req.url.split('?')[0];
		req.query = url.parse(req.url, true).query;
		/* We check security */
		if(_config.key != null) {
			if(typeof req.query.key != 'string' || req.query.key != _config.key) {
				return self.send(res, 'error', 'Invalid authentication.');
			}
		}
		var body = "";
		if(req.method == 'POST') {
			req.on('data', function(chunk) {
				body += chunk;
				if (body.length > 1e6) {
					req.connection.destroy();
				}
			}).on('end', function() {
				req.body = qs.parse(body);
				onProcess(req, res);
			})
		} else {
			onProcess(req, res);
		}
	};
	this.server = http.createServer(onRequest).listen(_config.port, _config.ip, function() {
		log.trace('Cluster server listening on port: %s', _config.port);
		if(typeof _callback == 'function') _callback();
		/* We start the supervisor. */
		self.__interval.redirect = setInterval(function() {
			self.supervise();
		}, self.proxy.config.get().cluster.supervisor * 1000);
	});
};

/* We define a hash of supervisor events that are to be fired once per supervise cycle. */
var _SUPERVISOR_EVENTS = {
	full: false,
	normal: false,
	warning: false
};

/*
* Supervises all the nodes and their connection count.
* */
cluster.prototype.supervise = function SuperviseNodes() {
	var maxConnections = 0,
		currentConnections = 0;
	for(var i=0; i < this.nodes.length; i++) {
		currentConnections += this.nodes[i].redirects;
		if(this.nodes[i].config.max_connections != null) {
			maxConnections += this.nodes[i].config.max_connections;
		}
		this.nodes[i].redirects = 0;	/* We reset the redirect counter. */
	}
	/* We now know that the cluster is full and the nodes cannot support this many connections */
	if(maxConnections <= currentConnections) {
		if(_SUPERVISOR_EVENTS.full) {
			_SUPERVISOR_EVENTS.full = false;
		} else {
			_SUPERVISOR_EVENTS.full = true;
			this.proxy.emit('cluster.full');
		}
	} else if(_SUPERVISOR_EVENTS.full) {/* If the cluster was previously full, it is now normal. */
			_SUPERVISOR_EVENTS.full = false;
			this.proxy.emit('cluster.normal');
		}

	/* We check if it has more than 90% connections active. */
	var percentage = Math.round(currentConnections * 100 / maxConnections);
	if(percentage >= this.proxy.config.get().cluster.critical && percentage < 100) {
		this.proxy.emit('cluster.warning', percentage);
	}
};


/*
* Whenever a node will want to register itself in the cluster, this function will be called and handle the process.
* */
cluster.prototype.handleRegister = function HandleRegister(req, res) {
	if(req.method != 'POST') {
		return this.send(res, 'error', 'Invalid method.');
	}
	var body = req.body,
		self = this,
		_data = {};
	if(typeof body.hostname != 'string' || typeof body.port != 'string' || isNaN(body.port)) {
		return this.send(res, 'error', 'Invalid post data.');
	}
	var nodeObj = new BlastNode(body),
		_found = false;
	for(var i=0; i < this.nodes.length; i++) {
		if(this.nodes[i].id == nodeObj.id) {
			this.nodes[i].destroy();
			this.nodes[i] = nodeObj;
			_found = true;
			break;
		}
	}
	nodeObj.supervise(this.proxy.config.get().cluster);
	if(!_found) this.nodes.push(nodeObj);
	var onUnregister = function() {
		if(nodeObj.destroyed) return;
		/* When a node expires, weunregister it */
		for(var i=0; i < self.nodes.length;i++) {
			if(self.nodes[i].id == nodeObj.id) {
				self.nodes.splice(i, 1);
				break;
			}
		}
		self.proxy.emit('node.unregister', nodeObj);
		nodeObj.destroy();
	};
	nodeObj.on('timeout', function() {
		if(nodeObj.destroyed) return;
		self.proxy.emit('node.timeout', nodeObj);
	}).on('ping', function() {
		if(nodeObj.destroyed) return;
		self.proxy.emit('node.ping', nodeObj);
	}).on('expire', onUnregister).on('unregister', onUnregister);
	self.proxy.emit('node.register', nodeObj);
	_data.type = 'success';
	_data.id = nodeObj.id;
	res.end(JSON.stringify(_data));
};


/*
* Whenever a node will ping the proxy telling it it is still alive, this is the function that will handle it.
* */
cluster.prototype.handlePing = function HandlePing(req, res) {
	if(typeof req.body.id != 'string') {
		return this.send(res, 'error', 'Node ID is required.');
	}
	for(var i=0; i < this.nodes.length; i++) {
		if(this.nodes[i].id == req.body.id) {
			var nodeObj = this.nodes[i];
			nodeObj.onPing();
			return this.send(res, 'success');
		}
	}
	return this.send(res, 'error', 'Node was not previously registered', {
		code: 1
	});
};

/*
* Returns an ajax response of the given type to the given response object.
* */
cluster.prototype.send = function SendResponse(res, type, message, data) {
	var _data = {
		type: type,
		message: message || ""
	};
	if(typeof data == 'object' && data != null) {
		for(var k in data) {
			_data[k] = data[k];
		}
	}
	res.setHeader('Content-Type', 'application/json');
	return res.end(JSON.stringify(_data));
};


module.exports = cluster;