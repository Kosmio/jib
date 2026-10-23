# Upgrading a deployment from PostgreSQL 15 to 17

For jib deployments that ran `postgres:15-alpine`.

## Why a procedure is needed

- A PostgreSQL 15 data directory cannot be opened by PostgreSQL 17: the data has to be dumped and restored.
- The PostgreSQL 15 overlays mounted the `jib-postgres-data` volume at `/var/lib/postgresql`, while the image keeps its data in `/var/lib/postgresql/data`. The database therefore lives in an **anonymous volume**, and `jib-postgres-data` only holds an empty `data/` directory.

The dev and prod overlays now bind-mount `~/jib/data/postgres` on the host at `/var/lib/postgresql/data`. The procedure fills that folder with a PostgreSQL 17 copy of the database **before** deploying, so the new `jib-postgres` container starts on the restored data and Strapi never runs on an empty database. The PostgreSQL 15 data is never modified: it stays in its anonymous volume until the last step. The same deploy moves Strapi uploads from the `jib-strapi-uploads` volume to `~/jib/data/uploads`, so step 4 copies them.

Deploying without the procedure loses nothing either: PostgreSQL 17 starts on an empty `~/jib/data/postgres`, Strapi seeds its initial content, media files answer 404, and the real data waits in the anonymous volume and in `jib-strapi-uploads`. See [Recovering after an unprepared deploy](#recovering-after-an-unprepared-deploy).

## Remote environments (dev, prod)

Run on the deploy server over SSH. Strapi and MCP stay stopped from step 1 until the deploy in step 4, so no edit or upload can land between the copies and the switch: the site is down for that window.

### 1. Dump the database

```sh
B=~/jib/backups/$(date +%F)-pg17-upgrade
mkdir -p $B

docker stop jib-strapi jib-mcp
docker exec jib-postgres pg_dump -U strapi -d strapi -Fc > $B/strapi-pg15.dump

# The archive must list table data
docker exec -i jib-postgres pg_restore -l < $B/strapi-pg15.dump | grep -c "TABLE DATA"
```

### 2. Note the anonymous volume

It holds the PostgreSQL 15 data and is the rollback copy. Keep its name until the upgrade is verified, and do not run `docker volume prune` meanwhile.

```sh
docker inspect jib-postgres \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}'
```

### 3. Restore into the new data folder with PostgreSQL 17

`~/jib/data/postgres` must not exist yet. The password is the one Strapi connects with, read from its container.

```sh
test ! -e ~/jib/data/postgres && mkdir -p ~/jib/data/postgres

PW=$(docker inspect jib-strapi --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DATABASE_PASSWORD=//p')

docker run -d --name jib-pg17-restore \
  -e POSTGRES_USER=strapi -e POSTGRES_DB=strapi -e POSTGRES_PASSWORD="$PW" \
  -v ~/jib/data/postgres:/var/lib/postgresql/data \
  postgres:17-alpine
# The first start initialises the cluster through a temporary server: wait for the real one
until docker logs jib-pg17-restore 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 1; done
until docker exec jib-pg17-restore pg_isready -U strapi -d strapi; do sleep 1; done

docker exec -i jib-pg17-restore pg_restore -U strapi -d strapi --no-owner --exit-on-error < $B/strapi-pg15.dump
```

Compare the row counts of both databases; the two outputs must be identical:

```sh
Q="select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]
   from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
diff <(docker exec jib-postgres psql -U strapi -d strapi -Atc "$Q") \
     <(docker exec jib-pg17-restore psql -U strapi -d strapi -Atc "$Q") && echo identical
```

Then stop the temporary container. The data stays in `~/jib/data/postgres`.

```sh
docker stop jib-pg17-restore && docker rm jib-pg17-restore
```

### 4. Copy the uploads into their host folder

Strapi is already stopped, so the volume no longer changes.

```sh
test ! -e ~/jib/data/uploads && mkdir -p ~/jib/data/uploads
docker run --rm -v jib-strapi-uploads:/from:ro -v ~/jib/data/uploads:/to alpine cp -a /from/. /to/
docker run --rm -v jib-strapi-uploads:/from:ro -v ~/jib/data/uploads:/to:ro alpine diff -r /from /to && echo identical
```

### 5. Deploy the new version

Run the **Deploy** GitHub Actions workflow with the new version, `reset_db` unchecked. The deploy recreates `jib-postgres` on PostgreSQL 17 with `~/jib/data/postgres`, and Strapi starts on the restored data and uploads.

```sh
docker exec jib-postgres psql -U strapi -d strapi -Atc "show server_version"   # 17.x
```

Check the content in the Strapi admin and on the site.

### 6. Clean up

Once the content and its images are verified, remove the PostgreSQL 15 anonymous volume noted in step 2, the `jib-postgres-data` volume, which only held an empty `data/` directory, and the `jib-strapi-uploads` volume. Keep the dump off the server or delete it.

```sh
docker run --rm -v jib-postgres-data:/d alpine find /d -mindepth 2   # must print nothing
docker volume rm <anonymous volume name> jib-postgres-data jib-strapi-uploads
```

### Rolling back

Until step 6 the PostgreSQL 15 anonymous volume, the uploads volume and the dump are untouched. Deploy the previous release, then restore the dump into its fresh PostgreSQL 15 database:

```sh
docker stop jib-strapi jib-mcp
docker exec jib-postgres psql -U strapi -d strapi -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec -i jib-postgres pg_restore -U strapi -d strapi --no-owner --exit-on-error < $B/strapi-pg15.dump
docker start jib-strapi jib-mcp
```

## Local environment

The local overlay bind-mounts `~/DockerVolumes/jib/postgres`, which holds only an empty `data/` directory for the same reason.

```sh
docker exec jib-postgres pg_dump -U strapi -d strapi -Fc > ~/jib-pg15-local.dump
make infra-down
rm -rf ~/DockerVolumes/jib/postgres
make infra-up
until docker logs jib-postgres 2>&1 | grep -q "PostgreSQL init process complete"; do sleep 1; done
until docker exec jib-postgres pg_isready -U strapi; do sleep 1; done
docker exec -i jib-postgres pg_restore -U strapi -d strapi --no-owner --exit-on-error < ~/jib-pg15-local.dump
```

Then start Strapi as usual.

## Recovering after an unprepared deploy

If the new version was deployed before step 1, Strapi runs on an empty PostgreSQL 17 database with its seed content, and the PostgreSQL 15 data sits in a dangling anonymous volume. Find it: it is the one holding a `PG_VERSION` of `15`.

```sh
for v in $(docker volume ls -qf dangling=true); do
  echo "$v: $(docker run --rm -v $v:/d alpine cat /d/PG_VERSION 2>/dev/null)"
done
```

Dump it with a temporary PostgreSQL 15 container:

```sh
B=~/jib/backups/$(date +%F)-pg17-upgrade && mkdir -p $B
docker run -d --name pg15-rescue -v <volume>:/var/lib/postgresql/data postgres:15-alpine
until docker exec pg15-rescue pg_isready -U strapi; do sleep 1; done
docker exec pg15-rescue pg_dump -U strapi -d strapi -Fc > $B/strapi-pg15.dump
docker rm -f pg15-rescue
```

Stop Strapi, copy the uploads into their folder, which already holds the seed's images (`diff` lists those as `Only in /to`), then restore the dump over the seeded database:

```sh
docker stop jib-strapi jib-mcp
docker run --rm -v jib-strapi-uploads:/from:ro -v ~/jib/data/uploads:/to alpine cp -a /from/. /to/
docker run --rm -v jib-strapi-uploads:/from:ro -v ~/jib/data/uploads:/to:ro alpine diff -r /from /to
docker exec jib-postgres psql -U strapi -d strapi -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker exec -i jib-postgres pg_restore -U strapi -d strapi --no-owner --exit-on-error < $B/strapi-pg15.dump
docker start jib-strapi jib-mcp
```

The seed's images stay in `~/jib/data/uploads`, referenced by no media entry.
