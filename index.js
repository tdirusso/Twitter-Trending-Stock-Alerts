const WebSocketServer = require('websocket').server;
const Twitter = require('twitter');
const express = require('express');
const path = require('path');
const http = require('http');
const app = express();

require('dotenv').config();

app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

const wsPort = 3001;
const port = 3000;

const client = new Twitter({
    consumer_key: process.env.CONSUMER_KEY,
    consumer_secret: process.env.CONSUMER_SECRET,
    access_token_key: process.env.ACCESS_TOKEN,
    access_token_secret: process.env.ACCESS_SECRET
});

const moonClient = new Twitter({
    consumer_key: process.env.MOON_CONSUMER_KEY,
    consumer_secret: process.env.MOON_CONSUMER_SECRET,
    access_token_key: process.env.MOON_ACCESS_TOKEN,
    access_token_secret: process.env.MOON_ACCESS_SECRET
});

const tickerRegex = /\$[A-Za-z]{2,6}/gm;
const hashTickerRegex = /#[A-Z]{2,6}/gm;

const tickerCounts = {};
const hashTickerCounts = {};

let sortedTickerCounts;
let sortedHashTickerCounts;

let shouldFetchBulk = true;

let topTicker;
let secondTopTicker;
let latestProcessID;

function tweetUpdate(status) {
    const topTickers = sortedTickerCounts.slice(0, 5);

    status += `${topTickers[0][0]} (${topTickers[0][1]})\n\n`;
    status += '----------\n\n';

    topTickers.slice(1, 5).forEach(ticker => {
        status += `${ticker[0]} (${ticker[1]})\n`;
    });

    moonClient.post('statuses/update', { status }, (error) => {
        if (error) {
            console.log(error);
        }
    });
}

function update() {
    let tweetCount = 10;

    if (shouldFetchBulk) {
        tweetCount = 100;
        shouldFetchBulk = false;
    }

    return new Promise((resolve, reject) => {
        client.get('search/tweets', { q: 'daytrading', result_type: 'recent', count: tweetCount }, (error, tweets, _) => {
            if (error) {
                reject(error);
            }

            tweets = tweets.statuses;

            if (tweets && tweets.length) {
                tweets.some(tweet => {
                    if ((latestProcessID && (tweet.id !== latestProcessID)) || !latestProcessID) {
                        const tickers = [...tweet.text.matchAll(tickerRegex)];
                        const hashTickers = [...tweet.text.matchAll(hashTickerRegex)];

                        tickers.forEach(ticker => {
                            const tickerVal = ticker[0].toUpperCase();
                            if (tickerCounts[tickerVal]) {
                                tickerCounts[tickerVal] = ++tickerCounts[tickerVal];
                            } else {
                                tickerCounts[tickerVal] = 1;
                            }
                        });

                        hashTickers.forEach(ticker => {
                            const tickerVal = ticker[0].toUpperCase();
                            if (hashTickerCounts[tickerVal]) {
                                hashTickerCounts[tickerVal] = ++hashTickerCounts[tickerVal];
                            } else {
                                hashTickerCounts[tickerVal] = 1;
                            }
                        });
                    } else {
                        return true;
                    }
                });

                latestProcessID = tweets[0].id;

                const tickerEntries = Object.entries(tickerCounts);
                const hashTickerEntries = Object.entries(hashTickerCounts);

                sortedTickerCounts = tickerEntries.sort((a, b) => b[1] - a[1]);
                sortedHashTickerCounts = hashTickerEntries.sort((a, b) => b[1] - a[1]);

                if (sortedTickerCounts.length > 2) {
                    if (tweetCount === 10 && secondTopTicker !== sortedTickerCounts[1][0]) {
                        tweetUpdate('2nd Place Update\n\n');
                    }

                    if (topTicker !== sortedTickerCounts[0][0]) {
                        tweetUpdate('1st Place Update\n\n');
                    }

                    topTicker = sortedTickerCounts[0][0];
                    secondTopTicker = sortedTickerCounts[1][0];
                }
            }

            resolve();
        });
    });
}

const server = http.createServer();
server.listen(wsPort);

const wsServer = new WebSocketServer({
    httpServer: server
});

let shouldConnect = true;

wsServer.on('request', function (request) {
    if (shouldConnect) {
        shouldConnect = false;
        const connection = request.accept(null, request.origin);

        let poller;

        update().then(() => {
            if (connection.state === 'open') {
                connection.sendUTF(JSON.stringify({ sortedTickerCounts, sortedHashTickerCounts }));
            }

            poller = setInterval(() => {
                update().then(() => {
                    if (connection.state === 'open') {
                        connection.sendUTF(JSON.stringify({ sortedTickerCounts, sortedHashTickerCounts }));
                    }
                }).catch(error => console.log(error));
            }, 60000);
        }).catch(error => console.log(error));

        connection.on('close', () => {
            clearInterval(poller);
            connection.close();
            shouldConnect = true;
        });
    } else {
        request.reject();
    }
});

app.get('/', (_, res) => {
    res.render('index');
});

app.listen(port);