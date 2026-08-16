-- Runs once when the postgres container's data volume is first created.
-- Gives the backend test suite its own database, separate from dev data.
CREATE DATABASE webdesignos_test;
