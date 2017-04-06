# Node-red-contrib-sts-mqtt

These nodes were modified from the original IBM node-red mqtt nodes to simplify the broker configuration in using along with the Sense Tecnic MQTT(STS-MQTT) platform. Most of the modification was intended to minimize the steps that users need to perform to connect to STS-MQTT, in which aims to provide stable MQTT connections with less connection errors.

Node: Each connection would require a unique client ID set up on sts-mqtt server

### STS-MQTT-in node

STS-MQTT-in node subscribes to a specified topic on STS-MQTT. If correct user credentials are provided, this node will return any messages from this topic.

In the Topic field, enter `users/{username}/{topic name}` to subscribe. For example, if user Tom would like to subscribes to topic "temperatureSensor", he would enter `users/tom/temperatureSensor` in the topic field.

Note: Please ensure that the username, client ID, topic all exist on [STS-MQTT](http://test-mqtt.sensetecnic.com).  

### STS-MQTT-out node

STS-MQTT-out node publishes to a specified topic on STS-MQTT. If correct user credentials are provided, this node will send in `msg.payload` to this topic.

In the Topic field, enter `users/{username}/{topic name}` to subscribe. For example, if user Tom would like to subscribes to topic "temperatureSensor", he would enter `users/tom/temperatureSensor` in the topic field.

Note: Please ensure that the username, client ID, topic all exist on [STS-MQTT](http://test-mqtt.sensetecnic.com).

Note: To enable the secret config options in sts-mqtt-broker node, select the username field, and press shift button 16 times. The config options for server url, port and tls settings will pop up.
