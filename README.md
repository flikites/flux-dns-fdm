experimental/not tested fully

# flux-dns-fdm

DNS based Flux Domain Manager:

A script that can be run locally alongside a [Technitium DNS](https://github.com/TechnitiumSoftware/DnsServer) server deployment. It will automatically add your [Flux](https://runonflux.io) deployment IPs to a specified domain name and zone within your DNS server using the Technitium DNS Servers API

Technitium DNS can serve authorative records for both ICANN Domains & [Handshake Domains](https://handshake.org).

The downfall to using this method in conjunction with flux, is that domain names will need the port appended to the end of the URL to access the application on the port it is hosted on. (on flux)

Things to do:

1. Add health check for Game Servers
2. Add health check for VPN Servers
3. Add API support for PowerDNS (https://varo.domains/api)
4. Add API support for Cloudflare (https://api.cloudflare.com/)
5. Add support for multiple apps/ports, zones and domains. (runs for multiple applications)

# How It Works

This script checks flux endpoints for IP Address changes every 5 minutes.

You can modify the cron job expression on line 129 of `/src/app.js`

Use ENV variables to specify your Flux app and port.

It then randomly grabs 5 flux nodes from `/src/ips.txt` and looks for common IPs between each of the queried Nodes/API, for your app specifically.

It then goes through a health check where it looks for http 200 OK status codes on all common IPs.

If it responds properly then A records with a TTL of 60 and the healthy IPs are created in the specified zone.

If old IPs exist in the zone that are not present in the latest set of common IPs, those A records are removed from the zone.

Currently only has support for [Technitium DNS API](https://github.com/TechnitiumSoftware/DnsServer)
<br>
https://github.com/TechnitiumSoftware/DnsServer

You can easily install your own self hosted DNS server using multiple methods, including docker (needs port 53 publicly open), with this [link](https://blog.technitium.com/2017/11/running-dns-server-on-ubuntu-linux.html):
https://blog.technitium.com/2017/11/running-dns-server-on-ubuntu-linux.html

To generate your API Key use the drop down in the top right hand corner of the webadmin UI titled "Create API Token"

or follow this [link](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md#create-api-token) for alternative instructions: https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md#create-api-token

# Pre-Requisites

1. You need a running Technitium DNS server with a static IP and port 53 tcp/udp open.
2. You need an active API created for your Technitium DNS server.
3. You need to create a zone on the Technitium DNS server for the domain name you plan to use.

# Install

To run this app in Ubuntu/Debain/Linux follow the below instructions:

create a .env file or set value to your environment according to `example_env`

Install curl & NVM:

`sudo apt install curl`

`curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash`

The nvm installer script creates an environment entry to the login script of the current user. You can either log out and log in again to load the environment or execute the below command to do the same.

`source ~/.bashrc`

Install Node using NVM:

`nvm install node`

Install dependencis using the command `npm install` or `yarn install`

To run and start the application:
`npm run start` or `yarn start`

You can run this script automatically at whatever interval you wish using a cron job.

## Docker:

build image
`docker build -t yourtag .`

run container
`docker run --network host --env-file=.env flux-dns-fdm`
or `docker run --network host --env ENV_NAME=VALUE --env ENV_NAME=VALUE flux-dns-fdm`

## Envirornment Variables

```DNS_SERVER_ADDRESS=http://127.0.0.1:5380
DNS_SERVER_API_KEY=your_api_key
DNS_ZONE_NAME=fluxvpn
DOMAIN_NAME=try.fluxvpn
APP_NAME=radiusraid
APP_PORT=36025
```
