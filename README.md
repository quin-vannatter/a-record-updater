# a-record-updater
This is a script specifically made for Domain.com. It periodically checks its own public IP and automatically updates the A records for a specified domain when it changes.

To compare, the current A records are loaded when the script is initially started. The update array determines which A records need to be updated.
If the specified records are not the same, they will be updated. If the A records are updated while the script is running, they won't get updated until
either the IP address changes or the script restarts.

Keep in mind, this script requires user credentials to be stored in plain text so use carefully.

## config.json
Needs to exist at root with `index.js`.

```
{
    "username": "domain.com username",
    "password": "domain.com password",
    "domain": "domain",
    "checkFrequencyMins": 5,
    "update": [
        "www",
        "@"
    ]
}
```