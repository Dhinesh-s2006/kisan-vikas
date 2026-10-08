const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

function loadJSON(filename) {
  const filePath = path.join(__dirname, "..", "docs", filename);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function seedDatabase() {
  const client = await pool.connect();

  try {
    console.log("Connected to PostgreSQL.");

    const centres = loadJSON("centres.json");
    const farmers = loadJSON("farmers.json");
    const slots = loadJSON("slots.json");
    const bookings = loadJSON("bookings.json");

    console.log(`Centres found: ${centres.length}`);
    console.log(`Farmers found: ${farmers.length}`);
    console.log(`Slots found: ${slots.length}`);
    console.log(`Bookings found: ${bookings.length}`);

    await client.query("BEGIN");

    // Insert centres
    for (const centre of centres) {
      await client.query(
        `INSERT INTO centres
        (centre_id, centre_name, village_town, district,
         daily_capacity_slots, state)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (centre_id) DO NOTHING`,
        [
          centre.centre_id,
          centre.centre_name,
          centre.village_town,
          centre.district,
          Number(centre.daily_capacity_slots),
          centre.state,
        ]
      );
    }

    // Insert farmers
    for (const farmer of farmers) {
      await client.query(
        `INSERT INTO farmers
        (farmer_id, name, phone, village, district,
         land_holding_acres, primary_crop,
         preferred_language, smartphone_access)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (farmer_id) DO NOTHING`,
        [
          farmer.farmer_id,
          farmer.name,
          farmer.phone,
          farmer.village,
          farmer.district,
          Number(farmer.land_holding_acres),
          farmer.primary_crop,
          farmer.preferred_language,
          farmer.smartphone_access,
        ]
      );
    }

    // Insert slots
    for (const slot of slots) {
      await client.query(
        `INSERT INTO slots
        (slot_id, centre_id, date, start_time, end_time,
         max_farmers, booked_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (slot_id) DO NOTHING`,
        [
          slot.slot_id,
          slot.centre_id,
          slot.date,
          slot.start_time,
          slot.end_time,
          Number(slot.max_farmers),
          Number(slot.booked_count),
        ]
      );
    }

    // Insert bookings
    for (const booking of bookings) {
      await client.query(
        `INSERT INTO bookings
        (booking_id, farmer_id, slot_id, centre_id,
         booking_date, crop, quantity_quintals, status,
         grading_result, procured_quantity_quintals,
         msp_rate_inr, payment_amount_inr, payment_status,
         queue_position_at_booking, estimated_wait_minutes,
         sms_notifications_sent)
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8,
         NULLIF($9, ''),
         NULLIF($10, '')::FLOAT,
         NULLIF($11, '')::FLOAT,
         NULLIF($12, '')::FLOAT,
         $13, $14, $15, $16)
        ON CONFLICT (booking_id) DO NOTHING`,
        [
          booking.booking_id,
          booking.farmer_id,
          booking.slot_id,
          booking.centre_id,
          booking.booking_date,
          booking.crop,
          Number(booking.quantity_quintals),
          booking.status,
          booking.grading_result,
          booking.procured_quantity_quintals,
          booking.msp_rate_inr,
          booking.payment_amount_inr,
          booking.payment_status,
          Number(booking.queue_position_at_booking),
          Number(booking.estimated_wait_minutes),
          Number(booking.sms_notifications_sent),
        ]
      );
    }

    await client.query("COMMIT");

    console.log("\nDatabase seeded successfully!");
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("\nSeeding failed:");
    console.error(error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seedDatabase();