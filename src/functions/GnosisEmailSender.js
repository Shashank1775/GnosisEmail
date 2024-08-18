const { app } = require('@azure/functions');

// Ensure these are correctly set in your environment
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;
const AZURE_EMAIL_CONNECTION_STRING = process.env.AZURE_EMAIL_CONNECTION_STRING;

// Run every 15 seconds
app.timer('EnvVariableLogger', {
    schedule: '0 0 0 * * *',  // Every 15 seconds
    handler: async (myTimer, context) => {
        context.log('Logging environment variables:');
        context.log(`MONGODB_URI: ${MONGODB_URI}`);
        context.log(`DATABASE_NAME: ${DATABASE_NAME}`);
        context.log(`COLLECTION_NAME: ${COLLECTION_NAME}`);
        context.log(`AZURE_EMAIL_CONNECTION_STRING: ${AZURE_EMAIL_CONNECTION_STRING}`);
    }
});
