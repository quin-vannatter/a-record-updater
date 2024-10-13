npm install

pm2 start --name a-record-updater node -- index.js "$PWD"
pm2 save