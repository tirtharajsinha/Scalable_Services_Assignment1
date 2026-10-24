DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sf_booking') THEN
    CREATE ROLE sf_booking LOGIN PASSWORD 'bookingpw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sf_inventory') THEN
    CREATE ROLE sf_inventory LOGIN PASSWORD 'inventorypw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sf_payment') THEN
    CREATE ROLE sf_payment LOGIN PASSWORD 'paymentpw';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sf_notification') THEN
    CREATE ROLE sf_notification LOGIN PASSWORD 'notificationpw';
  END IF;
END $$;

SELECT 'CREATE DATABASE sf_booking OWNER sf_booking'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sf_booking')\gexec

SELECT 'CREATE DATABASE sf_inventory OWNER sf_inventory'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sf_inventory')\gexec

SELECT 'CREATE DATABASE sf_payment OWNER sf_payment'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sf_payment')\gexec

SELECT 'CREATE DATABASE sf_notification OWNER sf_notification'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sf_notification')\gexec

REVOKE ALL ON DATABASE sf_booking FROM PUBLIC;
GRANT CONNECT ON DATABASE sf_booking TO sf_booking;
REVOKE ALL ON DATABASE sf_inventory FROM PUBLIC;
GRANT CONNECT ON DATABASE sf_inventory TO sf_inventory;
REVOKE ALL ON DATABASE sf_payment FROM PUBLIC;
GRANT CONNECT ON DATABASE sf_payment TO sf_payment;
REVOKE ALL ON DATABASE sf_notification FROM PUBLIC;
GRANT CONNECT ON DATABASE sf_notification TO sf_notification;
