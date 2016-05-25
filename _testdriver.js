var fs = require('fs');
var app = require('./index');

var event = JSON.parse(fs.readFileSync('_sampleEvent.json', 'utf8').trim());

var context = {};
callback = function (err, done) {
    if (err)
        console.log("Error: " + err);
    else
        console.log("Done: " + done);
}

app.handler(event, context, callback);