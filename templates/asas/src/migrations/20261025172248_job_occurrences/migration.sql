CREATE TABLE "mithaq_job_occurrences" (
	"task" text,
	"scheduled_for" timestamp(3) with time zone,
	CONSTRAINT "mithaq_job_occurrences_pkey" PRIMARY KEY("task","scheduled_for")
);
