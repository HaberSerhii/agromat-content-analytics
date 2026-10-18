# Production deployment

- When the user asks to publish or deploy this project to production, always commit the task's changes and push that commit to GitHub before deploying.
- Include requested project instructions in the commit. Stage only relevant files; leave unrelated local files and generated previews out of the commit.
- Run the checks appropriate to the changes, deploy the pushed revision using the project's deployment process, and verify that production is running that revision.
- Report the commit and deployment outcome. A local commit, push, or deployment trigger alone does not mean deployment succeeded.
