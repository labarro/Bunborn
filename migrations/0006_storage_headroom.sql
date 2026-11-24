-- No historical deletion. The Worker also checks physical storage before cognition.
DROP TRIGGER record_capacity;
CREATE TRIGGER record_capacity BEFORE INSERT ON records BEGIN
 SELECT CASE WHEN (SELECT bytes FROM storage_meter WHERE id=1)+length(CAST(new.content AS BLOB))+length(CAST(new.data AS BLOB))+length(new.associations)+500>180000000 THEN RAISE(ABORT,'storage_capacity') END;
END;
