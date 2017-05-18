/**
 * Copyright 2013, 2016 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
  "use strict";
  var mqtt = require("mqtt");
  var isUtf8 = require('is-utf8');

  // Load settings from Node-RED settings file

  var DEFAULT_HOST = "mqtt.sensetecnic.com";
  var DEFAULT_PORT = 8883;

  try {
    DEFAULT_HOST = RED.settings.sensetecnic.mqtt.host;
  } catch (err) {/* fallback to default values */}

  try {
    DEFAULT_PORT = RED.settings.sensetecnic.mqtt.port;
  } catch (err) {/* fallback to default values */}

  function matchTopic(ts,t) {
    if (ts == "#") {
      return true;
    }
    var re = new RegExp("^"+ts.replace(/([\[\]\?\(\)\\\\$\^\*\.|])/g,"\\$1").replace(/\+/g,"[^/]+").replace(/\/#$/,"(\/.*)?")+"$");
    return re.test(t);
  }

  function STSMQTTBrokerNode(n) {
    RED.nodes.createNode(this,n);

    // Configuration options passed by Node Red
    this.broker = (n.broker === "") ? DEFAULT_HOST: n.broker;
    this.port = n.port;

    this.clientid = n.clientid;
    this.usetls = n.usetls;
    this.verifyservercert = n.verifyservercert;

    this.enableWillMsg = n.enableWillMsg;
    this.enableBirthMsg = n.enableBirthMsg;

    // Config node state
    this.brokerurl = "";
    this.connected = false;
    this.connecting = false;
    this.closing = false;
    this.options = {};
    this.queue = [];
    this.subscriptions = {};

    if(n.enableBirthMsg && n.birthTopic) {
      this.birthMessage = {
        topic: n.birthTopic,
        payload: n.birthPayload || "",
        qos: Number(n.birthQos||0),
        retain: n.birthRetain=="true"|| n.birthRetain===true
      }
    } else {
      this.birthMessage = {}
    }

    if (this.credentials) {
      this.username = this.credentials.user;
      this.password = this.credentials.clientKey;
    }

    // this.usetls = true;
    this.compatmode = true;
    this.verifyservercert = false;
    this.keepalive = 60;
    this.cleansession = true;

    // Create the URL to pass in to the MQTT.js library
    if (this.brokerurl === "") {
      if (this.usetls) {
        this.brokerurl="mqtts://";
      } else {
        this.brokerurl="mqtt://";
      }
      if (this.broker !== "") {
        this.brokerurl = this.brokerurl+this.broker+":"+this.port;
      } else {
        this.brokerurl = this.brokerurl+"localhost:1883";
      }
    }

    // Build options for passing to the MQTT.js API
    this.options.clientId = this.clientid;
    this.options.username = this.username;
    this.options.password = this.password;
    this.options.keepalive = this.keepalive;
    this.options.clean = this.cleansession;
    this.options.reconnectPeriod = RED.settings.mqttReconnectTime||5000;
    this.options.protocolId = 'MQIsdp';
    this.options.protocolVersion = 3;

    // If there's no rejectUnauthorized already, then this could be an
    // old config where this option was provided on the broker node and
    // not the tls node
    if (typeof this.options.rejectUnauthorized === 'undefined') {
      this.options.rejectUnauthorized = (this.verifyservercert == "true" || this.verifyservercert === true);
    }

    if (n.enableWillMsg && n.willTopic) {
      this.options.will = {
        topic: n.willTopic,
        payload: n.willPayload || "",
        qos: Number(n.willQos||0),
        retain: n.willRetain=="true"|| n.willRetain===true
      };
    }

    // Define functions called by MQTT in and out nodes
    var node = this;
    this.users = {};

    this.register = function(mqttNode){
      node.users[mqttNode.id] = mqttNode;
      if (Object.keys(node.users).length === 1) {
        node.connect();
      }
    };

    this.deregister = function(mqttNode,done){
      delete node.users[mqttNode.id];
      if (node.closing) {
        return done();
      }
      if (Object.keys(node.users).length === 0) {
        if (node.client && node.client.connected) {
          return node.client.end(done);
        } else {
          node.client.end();
          return done();
        }
      }
      done();
    };

    this.connect = function () {
      if (!node.connected && !node.connecting) {
        node.connecting = true;
        node.client = mqtt.connect(node.brokerurl ,node.options);
        node.client.setMaxListeners(0);
        // Register successful connect or reconnect handler
        node.client.on('connect', function () {
          node.connecting = false;
          node.connected = true;
          node.log(RED._("mqtt.state.connected",{broker:(node.clientid?node.clientid+"@":"")+node.brokerurl}));
          for (var id in node.users) {
            if (node.users.hasOwnProperty(id)) {
              node.users[id].status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
            }
          }
          // Remove any existing listeners before resubscribing to avoid duplicates in the event of a re-connection
          node.client.removeAllListeners('message');

          // Re-subscribe to stored topics
          for (var s in node.subscriptions) {
            if (node.subscriptions.hasOwnProperty(s)) {
              var topic = s;
              var qos = 0;
              for (var r in node.subscriptions[s]) {
                if (node.subscriptions[s].hasOwnProperty(r)) {
                  qos = Math.max(qos,node.subscriptions[s][r].qos);
                  node.client.on('message',node.subscriptions[s][r].handler);
                }
              }
              var options = {qos: qos};
              node.client.subscribe(topic, options);
            }
          }

          // Send any birth message
          if (node.enableBirthMsg && node.birthMessage) {
            node.publish(node.birthMessage);
          }
        });
        node.client.on("reconnect", function() {
          for (var id in node.users) {
            if (node.users.hasOwnProperty(id)) {
              node.users[id].status({fill:"yellow",shape:"ring",text:"node-red:common.status.connecting"});
            }
          }
        })
        // Register disconnect handlers
        node.client.on('close', function () {
          if (node.connected) {
            node.connected = false;
            node.log(RED._("mqtt.state.disconnected",{broker:(node.clientid?node.clientid+"@":"")+node.brokerurl}));
            for (var id in node.users) {
              if (node.users.hasOwnProperty(id)) {
                node.users[id].status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
              }
            }
          } else if (node.connecting) {
            node.log(RED._("mqtt.state.connect-failed",{broker:(node.clientid?node.clientid+"@":"")+node.brokerurl}));
          }
        });

        // Register connect error handler
        node.client.on('error', function (error) {
          if (node.connecting) {
            node.client.end();
            node.connecting = false;
          }
        });
      }
    };

    this.subscribe = function (topic,qos,callback,ref) {
      ref = ref||0;
      node.subscriptions[topic] = node.subscriptions[topic]||{};
      var sub = {
        topic:topic,
        qos:qos,
        handler:function(mtopic,mpayload, mpacket) {
          if (matchTopic(topic,mtopic)) {
            callback(mtopic,mpayload, mpacket);
          }
        },
        ref: ref
      };
      node.subscriptions[topic][ref] = sub;
      if (node.connected) {
        node.client.on('message',sub.handler);
        var options = {};
        options.qos = qos;
        node.client.subscribe(topic, options);
      }
    };

    this.unsubscribe = function (topic, ref) {
      ref = ref||0;
      var sub = node.subscriptions[topic];
      if (sub) {
        if (sub[ref]) {
          node.client.removeListener('message',sub[ref].handler);
          delete sub[ref];
        }
        if (Object.keys(sub).length === 0) {
          delete node.subscriptions[topic];
          if (node.connected){
            node.client.unsubscribe(topic);
          }
        }
      }
    };

    this.publish = function (msg) {
      if (node.connected) {
        if (!Buffer.isBuffer(msg.payload)) {
          if (typeof msg.payload === "object") {
            msg.payload = JSON.stringify(msg.payload);
          } else if (typeof msg.payload !== "string") {
            msg.payload = "" + msg.payload;
          }
        }

        var options = {
          qos: msg.qos || 0,
          retain: msg.retain || false
        };
        node.client.publish(msg.topic, msg.payload, options, function (err){return});
      }
    };

    this.on('close', function(done) {
      this.closing = true;
      if (this.connected) {
        this.client.once('close', function() {
          done();
        });
        this.client.end();
      } else if (this.connecting) {
        node.client.end();
        done();
      } else {
        done();
      }
    });

  }

  RED.nodes.registerType("sts-mqtt-broker", STSMQTTBrokerNode,{
    credentials: {
      user: {type:"text"},
      clientKey: {type: "password"}
    }
  });

  function STSMQTTInNode(n) {
    RED.nodes.createNode(this,n);
    this.topic = n.topic;
    this.qos = parseInt(n.qos);
    if (isNaN(this.qos) || this.qos < 0 || this.qos > 2) {
      this.qos = 2;
    }
    this.broker = n.broker;
    this.brokerConn = RED.nodes.getNode(this.broker);
    if (!/^(#$|(\+|[^+#]*)(\/(\+|[^+#]*))*(\/(\+|#|[^+#]*))?$)/.test(this.topic)) {
      return this.warn(RED._("mqtt.errors.invalid-topic"));
    }
    var node = this;
    if (this.brokerConn) {
      this.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
      if (this.topic) {
        node.brokerConn.register(this);
        this.brokerConn.subscribe(this.topic,this.qos,function(topic,payload,packet) {
          if (isUtf8(payload)) { payload = payload.toString(); }
          try {
            var msg = {topic:topic,payload:JSON.parse(payload), qos: packet.qos, retain: packet.retain};
          } catch(e) {
            var msg = {topic:topic,payload:payload, qos: packet.qos, retain: packet.retain};
          }
          if ((node.brokerConn.broker === "localhost")||(node.brokerConn.broker === "127.0.0.1")) {
            msg._topic = topic;
          }
          node.send(msg);
        }, this.id);
        if (this.brokerConn.connected) {
          node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
        }
      }
      else {
        this.error(RED._("mqtt.errors.not-defined"));
      }
      this.on('close', function(done) {
        if (node.brokerConn) {
          node.brokerConn.unsubscribe(node.topic,node.id);
          node.brokerConn.deregister(node,done);
        }
      });
    } else {
      this.error(RED._("mqtt.errors.missing-config"));
    }
  }
  RED.nodes.registerType("sts-mqtt-in",STSMQTTInNode);

  function STSMQTTOutNode(n) {
    RED.nodes.createNode(this,n);
    this.topic = n.topic;
    this.qos = n.qos || null;
    this.retain = n.retain;
    this.broker = n.broker;
    this.brokerConn = RED.nodes.getNode(this.broker);
    var node = this;

    if (this.brokerConn) {
      this.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
      this.on("input",function(msg) {
        if (msg.qos) {
          msg.qos = parseInt(msg.qos);
          if ((msg.qos !== 0) && (msg.qos !== 1) && (msg.qos !== 2)) {
            msg.qos = null;
          }
        }
        msg.qos = Number(node.qos || msg.qos || 0);
        msg.retain = node.retain || msg.retain || false;
        msg.retain = ((msg.retain === true) || (msg.retain === "true")) || false;
        if (node.topic) {
          msg.topic = node.topic;
        }
        if ( msg.hasOwnProperty("payload")) {
          if (msg.hasOwnProperty("topic") && (typeof msg.topic === "string") && (msg.topic !== "")) { // topic must exist
            this.brokerConn.publish(msg);  // send the message
          }
          else { node.warn(RED._("mqtt.errors.invalid-topic")); }
        }
      });
      if (this.brokerConn.connected) {
        node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
      }
      node.brokerConn.register(node);
      this.on('close', function(done) {
        node.brokerConn.deregister(node,done);
      });
    } else {
      this.error(RED._("mqtt.errors.missing-config"));
    }
  }
  RED.nodes.registerType("sts-mqtt-out",STSMQTTOutNode);

  RED.httpAdmin.get('/defaultMqttServer', function(req, res) {
    res.send(JSON.stringify({
      server: DEFAULT_HOST,
      port: DEFAULT_PORT
    }));
  });

};
