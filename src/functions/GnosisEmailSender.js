const { app } = require('@azure/functions');
const { EmailClient, KnownEmailSendStatus } = require('@azure/communication-email');
const { MongoClient } = require('mongodb');

// Ensure these are correctly set in your environment
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;
const AZURE_EMAIL_CONNECTION_STRING = process.env.AZURE_EMAIL_CONNECTION_STRING;

const POLLER_WAIT_TIME = 10;  // Polling interval in seconds

app.timer('GnosisEmailSender', {
    schedule: '0 0 0 * * *',  // Every day at midnight
    handler: async (myTimer, context) => {
        if (!MONGODB_URI || !DATABASE_NAME || !COLLECTION_NAME || !AZURE_EMAIL_CONNECTION_STRING) {
            context.log.error('Missing one or more required environment variables.');
            return;
        }

        let client;
        try {
            // Initialize MongoDB client
            client = new MongoClient(MONGODB_URI);
            await client.connect();
            
            const db = client.db(DATABASE_NAME);
            const collection = db.collection(COLLECTION_NAME);

            // Fetch the users and their reminders where `sent` is false
            const users = await collection.find({ "reminders.sent": false }).toArray();

            if (users.length === 0) {
                context.log('No users with unsent reminders found in the database.');
                return;
            }

            // Initialize the EmailClient
            const emailClient = new EmailClient(AZURE_EMAIL_CONNECTION_STRING);

            for (const user of users) {
                const { userEmail, username, reminders } = user;

                if (!userEmail || reminders.length === 0) {
                    context.log(`Skipping user ${username} due to missing email or reminders.`);
                    continue;
                }

                // Filter reminders where `sent` is false
                const unsentReminders = reminders.filter(reminder => !reminder.sent);

                for (const reminder of unsentReminders) {
                    const message = {
                        senderAddress: "DoNotReply@6f4532a3-aa21-46f6-974a-1eebdb8e1e22.azurecomm.net",
                        content: {
                            subject: "Reminder for Your Upcoming Event",
                            plainText: reminder.title || "You have a reminder notification.",
                        },
                        recipients: {
                            to: [
                                {
                                    address: userEmail,
                                    displayName: username || "Customer",
                                }
                            ]
                        }
                    };

                    try {
                        // Send the email and start polling
                        const poller = await emailClient.beginSend(message);

                        let timeElapsed = 0;
                        while (!poller.isDone()) {
                            await poller.poll();
                            context.log("Email send polling in progress");

                            await new Promise(resolve => setTimeout(resolve, POLLER_WAIT_TIME * 1000));
                            timeElapsed += POLLER_WAIT_TIME;

                            if (timeElapsed > 180) {  // Timeout after 3 minutes
                                throw new Error("Polling timed out.");
                            }
                        }

                        const result = poller.getResult();
                        if (result.status === KnownEmailSendStatus.Succeeded) {
                            context.log(`Email sent successfully to ${userEmail}, operationId: ${result.id}`);
                            
                            // Update the reminder as sent
                            await collection.updateOne(
                                { _id: user._id, "reminders.id": reminder.id },
                                { $set: { "reminders.$.sent": true } }
                            );
                        } else {
                            context.log.error(`Failed to send email to ${userEmail}: ${result.error}`);
                        }
                    } catch (sendError) {
                        context.log.error(`Error sending email to ${userEmail}:`, sendError);
                    }
                }
            }

        } catch (error) {
            context.log.error('Error occurred in the function:', error);
        } finally {
            // Ensure MongoDB connection is closed
            if (client) {
                await client.close();
            }
        }
    }
});
