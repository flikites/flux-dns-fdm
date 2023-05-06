Flux DNS FDM - Cloudflare Single IP Development Branch


# flux-dns-fdm-cloudflare-single-ip

DNS based Flux Domain Manager For Cloudflare - With Single IP Support

You must pull the `cloudflare-single-ip` branch.

`git clone --branch cloudflare-single-ip https://github.com/FliKites/flux-dns-fdm.git`

It will automatically add a sinlge IP from your [Flux](https://runonflux.io) deployment to each of the specified domain names in the ENV varaible `DOMAIN_NAME`.

Furtheremore it will run a health check on a cron job that runs every 1 miniute to check the health of your deployments IP. You can configure it to run every 1 second (must rebuild)

If an IP that is allocated in Cloudflare DNS becomes unhealthy, the script will attempt to replace it with a unique IP not being used by any other domain name.

If no unique IP exist that can be allocated, it will add a random healthy IP from you deployment to the Cloudfare DNS for the zone you specify in `ZONE_NAME`. 

## Pre-Requisites

1. You need an active API created for your Cloudflare account that allows for DNS records to be pulled and updated.
2. You need to specify the zone name and the domain name(s) you plan to use in the .env file.
3. You need to specify your flux app name and port in the .env file.

To learn how to get your Cloudflare API key & Account ID vist this link:
https://developers.cloudflare.com/fundamentals/get-started/basic-tasks/find-account-and-zone-ids/

To deploy an app on Flux visit eithier of these links:

https://home.runonflux.io/apps/registerapp

https://jetpack2.app.runonflux.io/#/launch (Beta)


Please see the example .env file to use as a template for gettting started.

# Install


## Docker:

You can build and run this image with docker.

build image
`docker build -t yourtag .`

run container
`docker run host --env-file=.env wirewrex/flux-dns-fdm:single-ip`

## Envirornment Variables
```
DNS_SERVER_ADDRESS=https://api.cloudflare.com/client/v4
DNS_SERVER_API_KEY=<your-api-key>
DNS_SERVER_ACCOUNT_ID=<your-account-id>
APP_NAME=registry
APP_PORT=35000
DOMAIN_NAME=hub.lootlink.xyz,hub2.lootlink.xyz,hub3.lootlink.xyz,hub4.lootlink.xyz
ZONE_NAME=lootlink.xyz
```

## Cron Schedule

The script makes checks and updates every 10 minutes using a cron job.

You can update the cron expression on line 86 of `/src/main.js`
