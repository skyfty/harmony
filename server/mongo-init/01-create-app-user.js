const appDbName = process.env.MONGO_INITDB_DATABASE || "harmony";
const appUsername = process.env.MONGO_APP_USERNAME;
const appPassword = process.env.MONGO_APP_PASSWORD;

if (!appUsername || !appPassword) {
  throw new Error("MONGO_APP_USERNAME and MONGO_APP_PASSWORD are required");
}

const appDb = db.getSiblingDB(appDbName);
const existingUser = appDb.getUser(appUsername);

if (!existingUser) {
  appDb.createUser({
    user: appUsername,
    pwd: appPassword,
    roles: [{ role: "readWrite", db: appDbName }],
  });
  print(`Created MongoDB app user '${appUsername}' on database '${appDbName}'.`);
} else {
  print(`MongoDB app user '${appUsername}' already exists on database '${appDbName}'.`);
}
