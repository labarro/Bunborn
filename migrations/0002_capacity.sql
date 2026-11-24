CREATE TABLE storage_meter (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL, records INTEGER NOT NULL);
INSERT INTO storage_meter SELECT 1,COALESCE(SUM(length(CAST(content AS BLOB))+length(CAST(data AS BLOB))+length(associations)+500),0),COUNT(*) FROM records;
CREATE TRIGGER record_capacity BEFORE INSERT ON records BEGIN
 SELECT CASE WHEN (SELECT bytes FROM storage_meter WHERE id=1)+length(CAST(new.content AS BLOB))+length(CAST(new.data AS BLOB))+length(new.associations)+500>60000000 THEN RAISE(ABORT,'storage_capacity') END;
END;
CREATE TRIGGER record_meter AFTER INSERT ON records BEGIN
 UPDATE storage_meter SET bytes=bytes+length(CAST(new.content AS BLOB))+length(CAST(new.data AS BLOB))+length(new.associations)+500,records=records+1 WHERE id=1;
END;
CREATE INDEX memory_importance ON records(kind,importance,seq);
