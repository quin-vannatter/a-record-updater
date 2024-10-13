const fs = require("fs");
const puppeteer = require('puppeteer');
const https = require("https");

let config;
let savedIpAddress;
let currentIpAddress;

console.log(`
This script automatically updates A records in Domain.com depending on your current public IP address.
2FA authentication needs to be disabled. I.e. no email verification code.
`)

try {
    config = JSON.parse(fs.readFileSync([process.argv?.[2] || __dirname, "config.json"].join("/"), 'utf8'));
} catch {
    console.error("Expecting config.json in same directory as script. Should look like this: \n\n", JSON.stringify({
        "username": "domain.com username",
        "password": "domain.com password",
        "domain": "domain",
        "checkFrequencyMins": 5,
        "update": [
            "www",
            "@"
        ]
    }, undefined, 2))
}

if (config) {
    run();
} else {
    console.error("config.json missing. Exiting");
}

async function run() {
    try {
        if (!savedIpAddress) {
            savedIpAddress = await evaluateMappedIp();
        }
        currentIpAddress = await getPublicIpAddress();
    
        if (currentIpAddress !== savedIpAddress && savedIpAddress !== false) {
            console.log(`IP Addresses do not match. Updating: ${savedIpAddress} -> ${currentIpAddress}`);
            await evaluateMappedIp(currentIpAddress);
        }
    } catch(e) {
        console.error("Something went wrong: ", e);
    }

    setTimeout(() => run(), config.checkFrequencyMins * 1000 * 60)
}

async function getPublicIpAddress() {
    return new Promise(resolve => {
        https.get("https://api.ipify.org?format=json", resp => {
            let data = "";
            resp.on("data", chunk => data += chunk);
            resp.on("end", () => resolve(JSON.parse(data).ip));
        });
    });
}

async function evaluateMappedIp(ip) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on("console", x => {
        if (x.type() === "log" && x.text().startsWith("**")) {
            console.log(x.text().substring(2));
        }
    })
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36");
    await page.goto("https://www.domain.com");

    const result = await page.evaluate(async (config, ip) => {
        const console = {
            log: (message, ...args) => window.console.log(`**${message}`, ...args)
        }
        let cookie = document.cookie;
        let apiAccessKey;

        async function request(method, endpoint, body) {
            return new Promise(resolve => {
                var xhr = new XMLHttpRequest();
                xhr.open(method, endpoint);
        
                xhr.onreadystatechange = () => {
                    if (xhr.readyState === 4) {
                        cookie = xhr.getResponseHeader("Set-Cookie");
                        if (xhr.status === 200) {
                            try {
                                const result = JSON.parse(xhr.responseText);
                                resolve(result);
                            } catch {
                                resolve(xhr.responseText);
                            } 
                        } else {
                            resolve(undefined);
                        }
                    }
                }
        
                if (cookie !== undefined) {
                    xhr.setRequestHeader("Cookie", cookie);
                }

                xhr.send(JSON.stringify(body));
            });
        }

        async function call(body) {
            if (apiAccessKey === undefined) {
                apiAccessKey = /apiAccessKey:"([a-z0-9]+)"/.exec(await request("GET", "my-account/assets/js/ctb-widget.js"))?.[1];
            }
            body.requestInfo.apiAccessKey = apiAccessKey;
            return await request("POST", "sfcore.do", { request: body });
        }

        await call({
            requestInfo: {
                service: "SessionAPI",
                method: "getSessionInfo",
                clientId: "AccountManager"
            }
        });
        
        await call({
            requestInfo: {
                method: "authenticateUserLogin",
                service: "UserAPI",
                clientId: "AccountManager",
            },
            ignore2FA: false,
            userLoginName: config.username,
            password: config.password
        });

        const result = await call({
            domainName: config.domain,
            requestedSize: 100,
            startIndex: 0,
            requestInfo: {
                method: "getDomainHostRecords",
                clientId: "AccountManager",
                service: "DomainAPI"
            }
        });

        if (result?.response?.data?.dnsRecords !== undefined) {
            const update = config.update.map(x => `${[x === "@" ? undefined : x, config.domain].filter(x => x).join(".")}.`);
            const entries = result.response.data.dnsRecords.filter(x => update.includes(x.name) && x.type === "A");
    
            if (!ip && entries.length > 0) {
                return entries.every(x => x.value === entries[0].value) ? entries[0].value : undefined;
            } else {
                for (let i in entries) {
                    const entry = entries[i];
                    entry.action = "DELETE"
                    updatedEntry = {
                        ...JSON.parse(JSON.stringify(entry)),
                        action: "ADD",
                        value: ip
                    }
        
                    await call({
                        dnsRecords: [entry, updatedEntry],
                        domainName: config.domain,
                        requestInfo: {
                            clientId: "AccountManager",
                            method: "setDomainHostRecords",
                            service: "DomainAPI"
                        }
                    });
                }
            }
        } else {
            console.log("Being rate limited. Trying again later.");
            return false;
        }
    }, config, ip);

    await browser.close();
    return result;
}