
import mongoose from "mongoose";

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI; // prefer MONGODB_URI
  if (!uri) {
    console.error("❌ Missing MONGODB_URI (or MONGO_URI) environment variable");
    return;
  }

  try {
    mongoose.connection.on("connected", () => {
      console.log("✅ MongoDB Connected");
    });

    // Use the exact SRV string from Atlas in MONGODB_URI.
    // Do NOT append a database name here if your URI already contains one.
    await mongoose.connect(uri, {
      serverApi: { version: "1", strict: true, deprecationErrors: true },
      tls: true,
      // If your URI does NOT specify a default database and you want to use one, uncomment:
      // dbName: "tsc2025",
    });
  } catch (err) {
    console.error("❌ Mongo connection error:", err);
    throw err;
  }
};

export default connectDB;

