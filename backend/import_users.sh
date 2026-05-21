#!/bin/bash
# import_users.sh — Bulk-create resource users via curl

BASE_URL="http://127.0.0.1:8000"

# Your access token from the browser
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzc5MTE2NzQ4LCJpYXQiOjE3NzkwODc5NDgsImp0aSI6IjY4NTk1NjY5ODFlOTQwMGE4OTNlZTRkYTU2ZjFjMDRmIiwidXNlcl9pZCI6MX0.BQ2tjE8UnB8gTdvCDDfmia4XMhiyFGQbbVG-w0EMagA"

echo "✅ Using provided token."
echo ""

SUCCESS=0
FAILED=0
SKIPPED=0

# Args: emp_code "Full Name" email password
create_user() {
  local emp="$1"
  local name="$2"
  local email="$3"
  local password="$4"

  # Write payload via python to handle special chars in passwords safely
  python3 -c "
import json, sys
print(json.dumps({
    'name':      '$name',
    'email':     '$email',
    'password':  '$password',
    'password2': '$password',
    'role':      'resource',
}))
" > /tmp/payload.json

  RESPONSE=$(curl -s -o /tmp/curl_out.txt -w "%{http_code}" \
    -X POST "$BASE_URL/api/v1/auth/users/" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-Proto: https" \
    -H "Authorization: Bearer $TOKEN" \
    -d @/tmp/payload.json)

  BODY=$(cat /tmp/curl_out.txt)

  if [ "$RESPONSE" = "201" ]; then
    echo "  ✅ CREATED   [$emp] $email"
    ((SUCCESS++))
  elif echo "$BODY" | grep -qi "already exists\|unique\|duplicate"; then
    echo "  ⏭️  SKIPPED   [$emp] $email (already exists)"
    ((SKIPPED++))
  else
    echo "  ❌ FAILED    [$emp] $email → HTTP $RESPONSE: $BODY"
    ((FAILED++))
  fi
}

echo "👥 Creating resource users..."
echo "──────────────────────────────────────────────────────"

create_user "E0007" "Sahil Vinod Gupta"            "sahil.g@astracybertech.com"          "iiV9ReA7aL#0"
create_user "E0011" "Sai kumar Muppavala raju"     "saikumar@astracybertech.com"         "THuH0@&KIkit"
create_user "E0014" "Christian Dsouza"             "christian@astracybertech.com"        "3EEeuJ@gUSt1"
create_user "E0015" "Kahkashan Siddiqui"           "kahkashan@astracybertech.com"        "ChangeMe@123"
create_user "E0016" "Crispin Basil Quadros"        "crispin@astracybertech.com"          "p90P&vK6O3h9"
create_user "E0017" "Sahil Suresh Kargutkar"       "sahil@astracybertech.com"            "#38iZJsLIalc"
create_user "E0019" "Nehal Bhandari"               "nehal@astracybertech.com"            "g3JKqsQpS&Vx"
create_user "E0020" "Devashree K Gavankar"         "devashree@astracybertech.com"        "e06zAZhAw3#R"
create_user "E0022" "Arjavi R Patel"               "arjavi@astracybertech.com"           "151ut5tLn&Lq"
create_user "E0023" "Siddarth B shetty"            "sid.shetty@astracybertech.com"       "ChangeMe@123"
create_user "E0024" "Walter A Nunes"               "walter@astracybertech.com"           "X8RGAkX@6&Iz"
create_user "E0025" "Rishika Chopra"               "rishika@astracybertech.com"          "xCmY22@l1PfY"
create_user "E0028" "Aniruddha sankhe"             "aniruddha@astracybertech.com"        "jTPKDv6#&sdD"
create_user "E0029" "Faizad Pathan Khan"           "faizad@astracybertech.com"           "rqlJuzbZ&tY7"
create_user "E0031" "Sumit singh"                  "sumit@astracybertech.com"            "RW#5#9&suj#S"
create_user "E0033" "Amol Pednekar"                "amol.p@astracybertech.com"           "N#KQvuV8jVCZ"
create_user "E0034" "Siddharth Ankham"             "siddhart@astracybertech.com"         "knrZIV@qHg44"
create_user "E0035" "Yash Prajapati"               "yash.p@astracybertech.com"           "bQf3nePn&KV6"
create_user "E0036" "Fuzail Patel"                 "fuzail@astracybertech.com"           "VH9YYZv4j8k@"
create_user "E0037" "Sanjana Chaudhary"            "sanjana@astracybertech.com"          "5kCRC@xG0@NC"
create_user "E0038" "Navraj Rai"                   "navraj@astracybertech.com"           "qlO1sM#j9GMl"
create_user "E0039" "Arun Lad"                     "arun.l@astracybertech.com"           "ChangeMe@123"
create_user "E0040" "Lahu Shankar Dapkar"          "lahu.shankar@astracybertech.com"     "p#CvFhth42xI"
create_user "E0041" "Izran Imtiyaz Shaikh"         "izran.shaikh@astracybertech.com"     "U97Pg6ToPuN&"
create_user "E0042" "Hitarth Sharma"               "hitarth@astracybertech.com"          "DfBFuj7V&XxD"
create_user "E0043" "Dheer Bipin Gala"             "dheer.gala@astracybertech.com"       "ChangeMe@123"
create_user "E0044" "Gaurav Sunil Chindarkar"      "gaurav.chindarkar@astracybertech.com" "lnqns#RUn5@u"
create_user "E0053" "Mahesh Shivilingappa Mukkani" "mahesh@astracybertech.com"           "yVJ&OkNu79#B"
create_user "E0055" "Narsingh Yadav"               "narsingh.y@astracybertech.com"       "4efxCB8ed@&2"
create_user "E0056" "Aditya Gurav"                 "aditya.g@astracybertech.com"         "u6h4RhTqM&@X"
create_user "E0063" "Vedant Satav"                 "vedant.s@astracybertech.com"         "45C@E7v&8ZC@"
create_user "E0064" "Mihir Chaudhary"              "mihir.c@astracybertech.com"          "Jo##Q&cKf72s"
create_user "E0065" "Taher Jhalodwala"             "taher.j@astracybertech.com"          "nd4Ym&3P8GRH"
create_user "E0066" "Jayendra B Mestry"            "jayendra@astracybertech.com"         "SGl31f845KB@"
create_user "E0067" "Sarita Mukkani"               "sarita.mukkani@astracybertech.com"   "@Ft43&Gt@1Kd"
create_user "E0068" "Pawan Pamecha"                "pawan@astracybertech.com"            "2LB6ig5NwTo&"
create_user "E0070" "Shamita Allwyn Dsouza"        "shamita@astracybertech.com"          "3FAw2d#rD9wo"
create_user "E0071" "Praful Bharadia"              "praful.b@astracybertech.com"         "fRnTkI0&5akf"
create_user "E0072" "Ajay Vaykul"                  "ajay.v@astracybertech.com"           "NQ@HcTh98jTc"
create_user "E0074" "Falguni Rathord"              "falguni.r@astracybertech.com"        "L28@&U5sqdEf"
create_user "E0075" "Neha Yadav"                   "neha.y@astracybertech.com"           "n2q3m&9K6Koz"
create_user "E0077" "Rohit Tandel"                 "rohit.t@astracybertech.com"          "Npw&63sgcdF9"
create_user "E0078" "Atharv Shirke"                "atharv.s@astracybertech.com"         "0fX&5pqB2okc"
create_user "E0079" "Niraj Sambare"                "niraj.s@astracybertech.com"          "TzU&mkixS4Jw"
create_user "E0080" "Kajal Nachanekar"             "kajal.n@astracybertech.com"          "4n@u6qhV@3NZ"
create_user "E0081" "Chetan Santosh Bhalerao"      "chetan.b@astracybertech.com"         "fy&4LMuAwPsR"
create_user "E0082" "Shubham Khuspe"               "shubham.k@astracybertech.com"        "Yfn7h&0OWOm2"
create_user "E0084" "Ajaruddin Khan"               "ajaruddin.k@astracybertech.com"      "T09fCg2xQ&CK"
create_user "E0085" "Pankaj Chavan"                "pankaj.c@astracybertech.com"         "&35AUXwJ2I4j"
create_user "E0086" "Roshan Pampari"               "roshan.pampari@astracybertech.com"   "@J26wL0DHn8v"
create_user "E0087" "Prasad Raskar"                "prasad.r@astracybertech.com"         "We&pkVOVUQG3"
create_user "E0090" "Aditya Pradeep"               "aditya.p@astracybertech.com"         "Yqif5G@gPeJn"
create_user "E0091" "Naresh Kumar"                 "naresh.k@astracybertech.com"         "Yyn76Wq5g@A#"
create_user "E0092" "Nisha Gite"                   "nisha.gite@astracybertech.com"       "b6rFS@p&1ugc"
create_user "E0093" "Yash Radhakrushna Deshmukh"  "yash.d@astracybertech.com"           "Wnym3&8tyoB2"
create_user "E0094" "Satish Battalwar"             "satish.b@astracybertech.com"         "9@TXWyWoQ10Z"
create_user "E0096" "Amol Dethe"                   "amol.d@astracybertech.com"           "#1IRrUmPOvZk"

echo "──────────────────────────────────────────────────────"
echo "✅ Created : $SUCCESS"
echo "⏭️  Skipped : $SKIPPED"
echo "❌ Failed  : $FAILED"
echo ""
echo "⚠️  Not included — handle manually:"
echo "   E0088 roydonrebello@gmail.com (non-company email, will fail domain check)"
echo "──────────────────────────────────────────────────────"
