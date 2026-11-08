import { auth, defineIdentity } from "managed-deepagents";

// Who may call the agent: whoever holds a LangSmith key. Which analysis a
// run may read is a separate question, answered by the credential in its
// context, not by who called.
export const identity = defineIdentity({
  auth: auth.langsmithApiKey(),
});
