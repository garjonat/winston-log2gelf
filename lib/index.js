"use strict";

const os = require('os');
const net = require('net');
const secNet = require('tls');
const http = require('http');
const https = require('https');
const util = require('util');
const winston = require('winston');

/**
 * parse winston level as a string and return its equivalent numeric value
 * @return {int} level
 */
function levelToInt(level) {
    if (level === 'error') return 0;
    else if (level === 'warn') return 1;
    else if (level === 'info') return 2;
    else if (level === 'verbose') return 3;
    else if (level === 'debug') return 4;
    else if (level === 'silly') return 5;

    return 0;
}

/**
 * open a TCP socket and send logs to Gelf server
 * @param {string} msg – JSON stringified GELF msg
 */
const sendTCPGelf = function (host, port, tls) {
    const options = {
        host,
        port,
        rejectUnauthorized: false
    };

    // whether or not tls is required
    let clientType;
    if (tls) clientType = secNet;
    else clientType = net;

    const client = clientType.connect(options, () => {
        // console.log('Connected to GELF server');
    });

    client.on('end', () => {
        // console.log('disconnected from GELF server');
        process.exit(0);
    });

    client.on('error', (err) => {
        console.error(err);
        process.exit(3);
    });

    return (msg) => {
        client.write(`${msg}\0`);

        client.on('error', (err) => {
            console.error(err);
            process.exit(3);
        });
    };
};

/**
 * send logs to Gelf server via HTTP(S)
 * @param {string} msg – JSON stringified GELF msg
 */
const sendHTTPGelf = function (host, port, tls, user, pass) {
	const options = {
        port,
        hostname: host,
        path: '/gelf',
        method: 'POST',
		auth : user+':'+pass,
        rejectUnauthorized: false
    };

    let clientType;
    if (tls) clientType = https;
    else clientType = http;

    return (msg) => {
        options.headers = {
			'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(msg)
        };
		//	console.log('headers: ', options.headers);
        const req = clientType.request(options, (res) => {
            // usefull for debug
			if (res.statusCode==401) console.log('Authorization Required ', res.statusCode);
        });

        req.on('error', (e) => {
            console.error(e);
        });

        req.write(msg);
        req.end();
    };
};

const Log2gelf = winston.transports.Log2gelf = function (options) {
    this.name = options.name || 'log2gelf';
    this.hostname = options.hostname || os.hostname();
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 12201;
	this.username = options.username || '';
	this.password = options.password || '';
    this.protocol = options.protocol || 'tcp';
    this.service = options.service || 'nodejs';
    this.level = options.level || 'info';
    this.silent = options.silent || false;
    this.handleExceptions = options.handleExceptions || false;

    // set protocol to use
    if (this.protocol === 'tcp') this.send = sendTCPGelf(this.host, this.port, false);
    else if (this.protocol === 'tls') this.send = sendTCPGelf(this.host, this.port, true);
    else if (this.protocol === 'http') this.send = sendHTTPGelf(this.host, this.port, false,this.username,this.password);
    else if (this.protocol === 'https') this.send = sendHTTPGelf(this.host, this.port, true, this.username,this.password);
};

// Inherit from `winston.Transport` so you can take advantage
// of the base functionality and `.handleExceptions()`.
util.inherits(Log2gelf, winston.Transport);

Log2gelf.prototype.log = function (level, msg, meta, callback) {
	const timestamp = Math.floor(Date.now() / 1000);
    const intLevel = levelToInt(level);

    const gelfMsg = JSON.stringify({
        timestamp,
        level: intLevel,
        host: this.hostname,
        short_message: msg,
        full_message: meta,
        _service: this.service
    });

    this.send(gelfMsg);
    callback(null, true);
};