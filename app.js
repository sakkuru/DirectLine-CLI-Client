const Swagger = require('swagger-client');
const rp = require('request-promise');

const directLineSecret = process.env.DLSecret;
if (!directLineSecret) {
    console.log("Run with your bot's DirectLine secret\nDLSecret=XXXX npm start");
    return;
}
const directLineUserId = 'DirectLineClient';

const directLineSpecUrl = 'https://docs.botframework.com/en-us/restapi/directline3/swagger.json';
const directLineClient = rp(directLineSpecUrl)
    .then(spec => {
        return new Swagger({
            spec: JSON.parse(spec.trim()),
            usePromise: true
        });
    })
    .then(client => {
        return rp({
            url: 'https://directline.botframework.com/v3/directline/tokens/generate',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + directLineSecret
            },
            json: true
        }).then(response => {
            const token = response.token;
            client.clientAuthorizations.add('AuthorizationBotConnector', new Swagger.ApiKeyAuthorization('Authorization', 'Bearer ' + token, 'header'));
            return client;
        });
    })
    .catch(err => {
        console.error('Error initializing DirectLine client', err);
        throw err;
    });

// Once the client is ready, create a new conversation 
directLineClient.then(client => {
    client.Conversations.Conversations_StartConversation()
        .then(response => {
            const responseObj = response.obj;
            sendMessagesFromConsole(client, responseObj.conversationId);
            startReceivingWebSocketClient(responseObj.streamUrl, responseObj.conversationId);
        });
});

const sendMessagesFromConsole = (client, conversationId) => {
    const stdin = process.openStdin();
    // process.stdout.write('Reply > ');
    stdin.addListener('data', e => {
        const input = e.toString().trim();
        if (input) {
            if (input.toLowerCase() === 'exit') {
                return process.exit();
            }

            const messageData = {
                conversationId: conversationId,
                activity: {
                    textFormat: 'plain',
                    text: input,
                    type: 'message',
                    from: {
                        id: directLineUserId,
                        name: directLineUserId
                    }
                }
            }

            // Send message
            client.Conversations.Conversations_PostActivity(messageData).catch(err => {
                console.error('Error sending message:', err);
            });
            process.stdout.write('> ');
        }
    });
}

const startReceivingWebSocketClient = (streamUrl, conversationId) => {
    console.log('Starting WebSocket Client for message streaming on conversationId: ' + conversationId);

    const ws = new(require('websocket').client)();

    ws.on('connectFailed', error => {
        console.log('Connect Error: ' + error.toString());
    });

    ws.on('connect', connection => {
        console.log('WebSocket Client Connected');
        connection.on('error', error => {
            console.log("Connection Error: " + error.toString());
        });
        connection.on('close', () => {
            console.log('WebSocket Client Disconnected');
        });
        connection.on('message', message => {
            // Ignore these messages
            if (message.type === 'utf8' && message.utf8Data.length > 0) {
                const data = JSON.parse(message.utf8Data);
                printMessages(data.activities);
            }
        });
    });

    ws.connect(streamUrl);
}

// Helpers methods
const printMessages = activities => {
    if (activities && activities.length) {
        // Ignore own messages
        activities = activities.filter(m => { return m.from.id !== directLineUserId });

        if (activities.length) {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);

            // Print other messages
            activities.forEach(printMessage);

            process.stdout.write('Reply> ');
        }
    }
}

const printMessage = activity => {
    if (activity.text) {
        console.log(activity.text);
    }

    if (activity.attachments) {
        activity.attachments.forEach(attachment => {
            switch (attachment.contentType) {
                case "application/vnd.microsoft.card.thumbnail":
                case "application/vnd.microsoft.card.hero":
                    renderHeroCard(attachment);
                    break;
            }
        });
    }
}

const renderHeroCard = attachment => {
    const width = 70;

    const contentLine = content => {
        return ' '.repeat((width - content.length) / 2) +
            content +
            ' '.repeat((width - content.length) / 2);
    }

    console.log('/' + '*'.repeat(width + 1));
    if (attachment.content.title) {
        console.log('* ' + attachment.content.title);
    }

    if (attachment.content.buttons) {
        const buttons = attachment.content.buttons;
        buttons.forEach(button => {
            let buttonText = '* ' + button.title;
            if (button.type === 'openUrl' && button.value) {
                buttonText += ' (' + button.value + ')';
            }
            console.log(buttonText);
        });
    } else {
        console.log('*' + contentLine(attachment.content.title) + '*');
        console.log('*' + ' '.repeat(width) + '*');
        console.log('*' + contentLine(attachment.content.text) + '*');
    }
    console.log('*'.repeat(width + 1) + '/');
}