'use latest';

import express from 'express';
import morgan from 'morgan';
import { fromExpress } from 'webtask-tools';
import bodyParser from 'body-parser';
import request from 'request';

bodyParser.urlencoded();

var app = express();
app.use(morgan('combined'));
app.use(bodyParser.urlencoded());
app.use(bodyParser.json());

let storage = { videos: {} };

app.post('/cloudinary_webhook_handler', (req, res) => {
  let notification = req.body;

  if (notification.info_kind != 'google_speech') {
    res.send("OK");
    return;
  }

  let publicId = notification.public_id;
  storage.videos[publicId] = notification;

  res.send("OK");
});

// DELETE /storage
app.delete('/storage', (req, res) => {
  storage = { videos: {} };
  res.status(200);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(storage));
});

// GET /storage
app.get('/storage', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(storage));
});

// GET /poll?public_id=public_id
app.get('/poll', (req, res) => {
  let publicId = req.param("public_id");

  if (!publicId) {
    res.status(400);
    res.send("Missing parameter 'public_id'");
    return;
  }

  let uploadInfo = storage.videos[publicId];

  if (!uploadInfo) {
    res.status(404);
    res.send(`Cannot find info for video '${publicId}'.`);
    return;
  }

  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(uploadInfo));
});

// GET /grep?url=url&query=query
app.get('/grep', (req, res) => {
  let url = req.param("url");
  let query = req.param("query");

  if (!url) {
    res.status(400);
    res.send("Missing parameter 'url'");
    return;
  }

  if (!query) {
    res.status(400);
    res.send("Missing parameter 'query'");
    return;
  }

  query = query.toLowerCase();

  url = url.substr(0, url.lastIndexOf(".")) + ".transcript";
  url = url.replace('/video/', '/raw/');

  request(url, (error, response, body) => {
    if (error || response.statusCode >= 300) {
      res.send("Error receiving transcription file.");
      return;
    }

    let transcription = JSON.parse(body);
    let { cloudName, publicId } = parseUrl(url);

    let items = transcription.filter((item) => item.transcript.toLowerCase().includes(query));

    url = `http://res.cloudinary.com/${cloudName}/video/upload/`;

    if (items.length <= 0) {
      res.send("");
      return;
    }

    items.forEach((item, index) => {
      let startTime = item.words[0].start_time;
      let endTime = item.words[item.words.length - 1].end_time;

      if (endTime - startTime > 5) {
        let wordIndex = item.words.findIndex((item) => item.word.toLowerCase().includes(query));

        if (wordIndex !== -1) {
          let startIndex = Math.max(0, wordIndex - 3);

          let wordsLen = item.words.length;
          let endIndex = Math.min(wordIndex + 3, wordsLen);

          startTime = item.words[startIndex].start_time;
          endTime = item.words[endIndex].end_time;
        }
      }

      startTime = Math.max(startTime - 0.3, 0).toFixed(2);
      endTime = (endTime + 0.5).toFixed(2);

      if (index === 0) {
        url += `so_${startTime},eo_${endTime}/`;
      } else {
        url += `l_video:${publicId},so_${startTime},eo_${endTime},fl_splice/fl_layer_apply/`
      }
    })

    url += publicId;

    res.send(url);
  })
});

function parseUrl(url) {
  let re = /cloudinary[.]com[/]([^/]+)[/].*[/]([^/]+)[.][^.]+$/;
  let parsed = url.match(re);

  let cloudName = parsed[1];
  let publicId = parsed[2];

  return { cloudName, publicId };
}

const HTML_URL = "video-grep.html";

app.get("/", (req, res) => {
  res.setHeader('Content-Type', 'text/html');

  request.get(HTML_URL).pipe(res);
});

module.exports = fromExpress(app);
