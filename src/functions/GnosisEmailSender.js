const { app } = require('@azure/functions');
const { EmailClient, KnownEmailSendStatus } = require('@azure/communication-email');
const { MongoClient, ObjectId } = require('mongodb');

// Ensure these are correctly set in your environment
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;
const AZURE_EMAIL_CONNECTION_STRING = process.env.AZURE_EMAIL_CONNECTION_STRING;

const POLLER_WAIT_TIME = 10;  // Polling interval in seconds

app.timer('GnosisEmailSender', {
    schedule: '*/45 * * * * *',  // Every day at midnight
    handler: async (myTimer, context) => {
        context.log('GnosisEmailSender function started.');

        // Validate environment variables
        if (!MONGODB_URI || !DATABASE_NAME || !COLLECTION_NAME || !AZURE_EMAIL_CONNECTION_STRING) {
            context.log.error('Missing one or more required environment variables.');
            context.log.error(`MONGODB_URI: ${MONGODB_URI ? 'Loaded' : 'Missing'}`);
            context.log.error(`DATABASE_NAME: ${DATABASE_NAME ? 'Loaded' : 'Missing'}`);
            context.log.error(`COLLECTION_NAME: ${COLLECTION_NAME ? 'Loaded' : 'Missing'}`);
            context.log.error(`AZURE_EMAIL_CONNECTION_STRING: ${AZURE_EMAIL_CONNECTION_STRING ? 'Loaded' : 'Missing'}`);
            return;
        }

        let client;
        try {
            // Initialize MongoDB client
            context.log('Connecting to MongoDB...');
            client = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
            await client.connect();
            context.log('Connected to MongoDB successfully.');

            const db = client.db(DATABASE_NAME);
            const collection = db.collection(COLLECTION_NAME);

            // Fetch users with unsent reminders
            context.log('Fetching users with unsent reminders...');
            const users = await collection.find({ "reminders.sent": false }).toArray();

            if (!users || users.length === 0) {
                context.log('No users with unsent reminders found in the database.');
                return;
            }
            context.log(`Found ${users.length} user(s) with unsent reminders.`);

            // Initialize the EmailClient
            context.log('Initializing EmailClient...');
            const emailClient = new EmailClient(AZURE_EMAIL_CONNECTION_STRING);
            context.log('EmailClient initialized successfully.');

            for (const user of users) {
                const { _id, userEmail, username = 'Customer', reminders } = user;

                if (!userEmail) {
                    context.log(`Skipping user with ID ${_id} due to missing email address.`);
                    continue;
                }

                if (!reminders || reminders.length === 0) {
                    context.log(`Skipping user ${username} due to no reminders.`);
                    continue;
                }

                // Filter reminders where `sent` is false
                const unsentReminders = reminders.filter(reminder => !reminder.sent);

                if (unsentReminders.length === 0) {
                    context.log(`No unsent reminders found for user ${username}.`);
                    continue;
                }

                context.log(`Processing ${unsentReminders.length} unsent reminder(s) for user ${username}.`);

                for (const reminder of unsentReminders) {
                    const { id, title = 'You have a reminder notification.' } = reminder;

                    if (!id) {
                        context.log(`Skipping reminder for user ${username} due to missing reminder ID.`);
                        continue;
                    }

                    const message = {
                        senderAddress: "DoNotReply@your_domain.azurecomm.net",
                        content: {
                            subject: "Reminder for Your Upcoming Event",
                            plainText: title,
                        },
                        recipients: {
                            to: [
                                {
                                    address: userEmail,
                                    displayName: username,
                                }
                            ]
                        }
                    };

                    try {
                        context.log(`Sending email to ${userEmail} for reminder ID ${id}...`);
                        const poller = await emailClient.beginSend(message);

                        let timeElapsed = 0;
                        while (!poller.isDone()) {
                            await poller.poll();
                            context.log('Email send polling in progress...');

                            await new Promise(resolve => setTimeout(resolve, POLLER_WAIT_TIME * 1000));
                            timeElapsed += POLLER_WAIT_TIME;

                            if (timeElapsed > 180) {  // Timeout after 3 minutes
                                throw new Error('Polling timed out.');
                            }
                        }

                        const result = poller.getResult();
                        if (result.status === KnownEmailSendStatus.Succeeded) {
                            context.log(`Email sent successfully to ${userEmail}, operationId: ${result.id}`);

                            // Update the reminder as sent
                            const updateResult = await collection.updateOne(
                                { _id: ObjectId(_id), "reminders.id": id },
                                { $set: { "reminders.$.sent": true } }
                            );

                            if (updateResult.modifiedCount === 1) {
                                context.log(`Reminder ID ${id} marked as sent for user ${username}.`);
                            } else {
                                context.log.error(`Failed to update reminder ID ${id} for user ${username}.`);
                            }
                        } else {
                            context.log.error(`Failed to send email to ${userEmail}: ${result.error}`);
                        }
                    } catch (sendError) {
                        context.log.error(`Error sending email to ${userEmail} for reminder ID ${id}:`, sendError);
                    }
                }
            }

        } catch (error) {
            context.log.error('An error occurred during the execution of the function:', error);
        } finally {
            // Ensure MongoDB connection is closed
            if (client) {
                try {
                    await client.close();
                    context.log('MongoDB connection closed successfully.');
                } catch (closeError) {
                    context.log.error('Error closing MongoDB connection:', closeError);
                }
            }
            context.log('GnosisEmailSender function execution completed.');
        }
    }
});
