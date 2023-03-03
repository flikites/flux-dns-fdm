Flux DNS FDM - Cloudflare v2.1 is out now and gracefully handles record removals for domains associated with your Flux app(s) only. 

You can download the newest version from [Releases](https://github.com/FliKites/flux-dns-fdm/releases)

W̶A̶R̶N̶I̶N̶G̶:̶ ̶C̶u̶r̶r̶e̶n̶t̶l̶y̶ ̶t̶h̶i̶s̶ ̶b̶r̶a̶n̶c̶h̶ ̶w̶i̶l̶l̶ ̶r̶e̶m̶o̶v̶e̶ ̶a̶n̶y̶ ̶A̶ ̶r̶e̶c̶o̶r̶d̶s̶ ̶n̶o̶t̶ ̶a̶s̶s̶o̶c̶i̶a̶t̶e̶d̶ ̶w̶i̶t̶h̶ ̶F̶l̶u̶x̶ ̶a̶p̶p̶s̶.̶ ̶T̶h̶i̶s̶ ̶w̶i̶l̶l̶ ̶b̶e̶ ̶f̶i̶x̶e̶d̶ ̶i̶n̶ ̶t̶h̶e̶ ̶c̶o̶m̶i̶n̶g̶ ̶w̶e̶e̶k̶s̶.̶

# flux-dns-fdm-cloudflare

DNS based Flux Domain Manager For Cloudflare:

You must pull the `Cloudflare` branch for use with cloudflare.

`git clone --branch cloudflare https://github.com/FliKites/flux-dns-fdm.git`

It will automatically add your [Flux](https://runonflux.io) deployment IPs to a specified domain name and zone within your Cloudflare DNS server account using the Cloudflare API.

If the domains don't exist within the zone, they will be automatically created and added for you.

This script that can be run pretty much anywhere, it does not require public ports to be open. (outgoing internet connection is required)

The downfall to using this method in conjunction with flux, is that domain names will need the port appended to the end of the URL to access the application on the port it is hosted on. (on flux)

You can run a single instance of this script to update multiple domains and flux apps at one time. (See Multiple Domains & Apps below)

# Pre-Requisites

1. You need an active API created for your Cloudflare account.
2. You need to create the zone in Cloudflare and note the ZONE ID
3. You need to specify the zone and specifiy the domain name(s) you plan to use in the .env file.
4. You need to specify your flux app name and port in the .env file.

To get your Cloudflare API & Zone ID vist this link:
https://developers.cloudflare.com/fundamentals/get-started/basic-tasks/find-account-and-zone-ids/

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
