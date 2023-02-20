experimental/not tested fully

# flux-dns-fdm-cloudflare

You must pull the `Cloudflare` branch for use with cloudflare.

DNS based Flux Domain Manager For Cloudflare:

It will automatically add your [Flux](https://runonflux.io) deployment IPs to a specified domain name and zone within your Cloudflare DNS server account using the Cloudflare API

This script that can be run pretty much anywhere, it does not require public ports to be open. (outgoing internet connection is required)

The downfall to using this method in conjunction with flux, is that domain names will need the port appended to the end of the URL to access the application on the port it is hosted on. (on flux)

You can run a single instance of this script to update multiple domains and flux apps at one time. (See Multiple Domains & Apps below)

# Pre-Requisites

1. You need an active API created for your Cloudflare account.
2. You need to create the zone in Cloudflare and note the ZONE ID
3. You need to specify the zone and specifiy the domain name(s) you plan to use in the .env file.
4. You need to specify your flux app name and port in the .env file.

Please see the example .env file to use as a template for gettting started.

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

## Docker:

build image
`docker build -t yourtag .`

run container
`docker run host --env-file=.env flux-dns-fdm`
or `docker run --env ENV_NAME=VALUE --env ENV_NAME=VALUE flux-dns-fdm`

## Envirornment Variables
```DNS_SERVER_ADDRESS=https://api.cloudflare.com/client/v4
DNS_SERVER_API_KEY=<your-api-key>
APP_NAME=nostr
APP_PORT=35860
DNS_ZONE_NAME=<your-cloudflare-dns-zone>
DOMAIN_NAME=<domain-name-that-matches-zone> 
```

## Cron Schedule

The script makes checks and updates every 10 minutes using a cron job.

You can update the cron expression on line 86 of `/src/main.js`

## Multiple Domains & Apps

You can specify multiple flux apps and domain names by using comma seperated ENV variables.

The ENV variables that you need to change are listed below.

Static Example:

```
APP_NAME=app1,app2,port3
APP_PORT=port1,port2,port3
DNS_ZONE_NAME=zone1,zone2,zone3
DOMAIN_NAME=domain1,domain2,domain3
```
Actual Example:
```
APP_NAME=nostr,dane,dane
APP_PORT=35860,33333,33333
DNS_ZONE_NAME=1f,1f,1f
DOMAIN_NAME=d1.lootlink.xyz,d2.lootlink.xyz,d3.lootlink.xyz
```
In the "Actual Example" above, I used the same Cloudflare ZONE ID for all 3 flux apps, which in turn led to the domain name using the same prefix (lootlink.xyz) 

Your Zone ID MUST be the matching zone for the corresponding domain name.
