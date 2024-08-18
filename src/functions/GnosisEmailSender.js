const { app } = require('@azure/functions');
const { EmailClient, KnownEmailSendStatus } = require('@azure/communication-email');
const { MongoClient } = require('mongodb');

// Ensure these are correctly set in your environment
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;
const AZURE_EMAIL_CONNECTION_STRING = process.env.AZURE_EMAIL_CONNECTION_STRING;

// Run every 15 seconds
app.timer('EnvVariableLogger', {
    schedule: '*/15 * * * * *',  // Every 15 seconds
    handler: async (myTimer, context) => {
    context.log("Starting")
    let client;
        try{
        client = new MongoClient(MONGODB_URI);
            await client.connect();
            
            const db = client.db(DATABASE_NAME);
            const collection = db.collection(COLLECTION_NAME);
            context.log("Connected to DATABASE")
        } catch(error) {
            context.log(error)
        }
    }
});
