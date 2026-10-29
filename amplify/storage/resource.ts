import { defineStorage } from "@aws-amplify/backend";

// Private file storage (S3) for uploaded resumes.
// {entity_id} is each signed-in user's identity ID, so every user can only
// read, write, and delete files in their own folder.
export const storage = defineStorage({
  name: "jobTrackerFiles",
  access: (allow) => ({
    "resumes/{entity_id}/*": [allow.entity("identity").to(["read", "write", "delete"])],
  }),
});