# minor version bump
npm version patch

# create the current_release directory if it does not exist
mkdir -p dynamic-highlights-optimized

# make a copy of the main.js, manifest.json, and styles.css files in another folder
cp main.js dynamic-highlights-optimized
cp manifest.json dynamic-highlights-optimized
cp styles.css dynamic-highlights-optimized

# compress the current_release folder into a zip file
# zip -r release.zip current_release
zip -vr dynamic-highlights-optimized.zip dynamic-highlights-optimized -x "*.DS_Store"

mv dynamic-highlights-optimized.zip release.zip

# remove the current_release folder
# rm -rf dynamic-highlights-optimized

# gac "Push for Release"
git add -A
git commit -m "Prepare for Git Release"
# git push origin main
echo "Pushing to main tag... "
echo "git push origin tag 1.0.4"
echo "Creating a new release... "
echo 'gh release create 1.0.4 release.zip main.js manifest.json styles.css --title "Aesthetics" --notes "Improve aesthetics"'

