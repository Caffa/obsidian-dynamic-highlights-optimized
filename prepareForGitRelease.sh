# minor version bump
npm version patch --no-git-tag-version

# create the current_release directory if it does not exist
mkdir -p dynamic-highlights-optimized

# make a copy of the main.js, manifest.json, and styles.css files in another folder
cp dist/main.js dynamic-highlights-optimized
cp manifest.json dynamic-highlights-optimized
cp styles.css dynamic-highlights-optimized
# compress the current_release folder into a zip file
# zip -r release.zip current_release
zip -vr dynamic-highlights-optimized.zip dynamic-highlights-optimized -x "*.DS_Store"

mv dynamic-highlights-optimized.zip release.zip

# remove the current_release folder
# rm -rf dynamic-highlights-optimized

# Get the new version and create a tag without 'v' prefix
VERSION=$(node -p "require('./package.json').version")
git add -A
git commit -m "Prepare for Git Release. Bump version to $VERSION"
git tag $VERSION
# git push origin main
echo "Pushing to main tag... "
# echo "git push origin tag $VERSION"
git push origin tag $VERSION
echo "Creating a new release... "
LASTCOMMIT=$(git log -1 --pretty=%B)
# Create a new release on GitHub with the zip file and the last commit message
gh release create $VERSION release.zip --title "Release $VERSION" --notes "$LASTCOMMIT"

