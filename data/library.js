import { playlistVideos } from './playlist-videos.js';

export const programs = [
  {
    slug: 'chief-resident', name: 'Chief Resident', short: 'CR', description: 'Resources for chief and senior residents.',
    current: [],
    archives: [{ title: 'Chief and Senior Resident — Videos from 2020 to 2024', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLRSo5uXl0WzWi76-SRQfDF7AVY5JT5XTD', meta: 'SEMCME video archive', videos: playlistVideos['PLRSo5uXl0WzWi76-SRQfDF7AVY5JT5XTD'] }]
  },
  {
    slug: 'faculty-development', name: 'Faculty Development', short: 'FD', description: 'Teaching, evaluation, leadership, and professional development for medical educators.',
    current: [{ title: 'The Stanford Learning Model', presenter: 'Kelley Skeff, MD, PhD, MACP; Michael Barnes, MD, FACP; Francisco Davila, MD, MHPE, FACP; Aimee Espinosa, MD; James Kruer, MD', date: 'September 20, 2024', type: 'recording', url: 'https://www.youtube.com/watch?v=9NYw8aLP_Ik' }],
    archives: [{ title: 'Faculty Development — Videos from 2020 to 2023', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLRSo5uXl0WzUe2QpGjL3VWKYlqy34xMs-', meta: 'SEMCME video archive', videos: playlistVideos['PLRSo5uXl0WzUe2QpGjL3VWKYlqy34xMs-'] }]
  },
  {
    slug: 'jedi', name: 'JEDI', short: 'JE', description: 'Justice, equity, diversity, and inclusion learning resources.',
    current: [
      { title: 'Structural and Social Antecedents of Health — Virtual Training', presenter: 'Robert Flora, MD, MBA, MPH and Aubin Whitmer, C-TAGME', date: 'February 23, 2024', type: 'recording', url: 'https://youtu.be/m1UuVEuirYw' },
      { title: 'Understanding Implicit Bias in Healthcare', presenter: 'Asha Shajahan, MD, MHSA', date: 'February 23, 2024', type: 'recording', url: 'https://youtube.com/watch?v=DNxlQsvY3g4' }
    ],
    archives: [{ title: 'JEDI — Videos from 2020 to 2023', type: 'playlist', url: 'https://www.youtube.com/watch?v=UteMvjCkstg&list=PLRSo5uXl0WzWsHLxCGwJ4zOSNOeBQ6Gh0', meta: 'SEMCME video archive', videos: playlistVideos['PLRSo5uXl0WzWsHLxCGwJ4zOSNOeBQ6Gh0'] }]
  },
  {
    slug: 'lecture-series', name: 'Lecture Series & Courses', short: 'LS', description: 'Interdisciplinary lecture series, practical courses, and timely topics.',
    upcoming: [
      { title: 'Research Workshop Series', type: 'course', url: 'https://lp.constantcontactpages.com/ev/reg/6hnekd2', meta: 'Registration' },
      { title: 'Surgery Basic Science', type: 'course', url: 'https://lp.constantcontactpages.com/ev/reg/gkfrgxw', meta: 'Registration' }
    ],
    current: [
      { group: 'AI in Medicine Series', title: "Launching the AI Journey: Medicine’s Next Chapter Begins Here", presenter: 'Saroj Misra, DO, FAAP, FACOFP and David Sengstock, MD, MS', date: 'October 15, 2025', type: 'recording', url: 'https://youtu.be/-QAN450BzA0' },
      { group: 'AI in Medicine Series', title: 'Understanding AI: A Look Under the Hood', presenter: 'N. Sara Merchawi, PhD', date: 'November 5, 2025', type: 'recording', url: 'https://youtu.be/nneXXRrq60M' },
      { group: 'Hot Topics', title: 'Impact of Sleep in Medicine', presenter: 'Bhavin Dalal, MD', date: 'November 14, 2025', type: 'recording', url: 'https://youtu.be/FBmmp7uUxFA' },
      { group: 'Hot Topics', title: 'Personality and Leadership Style', presenter: 'Stacy Payne, MA', date: 'September 12, 2025', type: 'recording', url: 'https://youtu.be/Yi6J6-_YeeI' },
      { group: 'Hot Topics', title: 'Telehealth & Digital Health Equity', presenter: 'Ally Hunter, MPH', date: 'May 20, 2025', type: 'recording', url: 'https://youtu.be/Ug1QezYztnI' },
      { group: 'Hot Topics', title: 'Reframing Your Perspective: Finding Joy in Medicine', presenter: 'Mara Hoffert, PhD and Odaliz Abreau Lanfranco, MD', date: 'February 18, 2025', type: 'recording', url: 'https://youtu.be/moNmjFAr8tw' },
      { group: 'Hot Topics', title: 'Clinical Bioethics and Pedagogy', presenter: 'Jason Wasserman, PhD', date: 'February 7, 2025', type: 'recording', url: 'https://youtu.be/WRcblZ81lyI' },
      { group: 'Hot Topics', title: 'From Boomers to Zoomers: Fusing Generational Wisdom in Education', presenter: 'Mara Hoffert, PhD and Christie Morgan, MD', date: 'January 31, 2025', type: 'recording', url: 'https://youtu.be/aJXvjAPRqgE' },
      { group: 'Pediatric Lunch & Learn', title: 'Building Healthy Smiles: Pediatric Dentistry', presenter: 'Dana Kleckler, RDH and April Kotermanski, RDH', date: 'October 27, 2025', type: 'recording', url: 'https://youtu.be/hu5_3sR4l_k' },
      { group: 'Pediatric Lunch & Learn', title: 'Emerging Infectious Diseases: Preparing for the Next Pandemic', presenter: 'Eric McGrath, MD', date: 'November 17, 2025', type: 'recording', url: 'https://youtu.be/96NObA_Vig8' },
      { group: 'Preparing for Practice', title: 'Preparing for Practice 2025 Session I', presenter: 'Susan Sanford, JD', date: 'October 1, 2025', type: 'recording', url: 'https://youtu.be/FNuA7hZQetE' },
      { group: 'Preparing for Practice', title: 'Preparing for Practice 2025 Session II', presenter: 'Susan Sanford, JD', date: 'October 8, 2025', type: 'recording', url: 'https://youtu.be/drfV5pbHorc' }
    ],
    archives: [
      { title: 'Hot Topics — Videos from 2020 to 2024', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLRSo5uXl0WzXvpJk_R00QYfb7qpUWfK_H', videos: playlistVideos['PLRSo5uXl0WzXvpJk_R00QYfb7qpUWfK_H'] },
      { title: 'Pediatric Lunch & Learn — Videos from 2022 to 2025', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLRSo5uXl0WzWo9_rWLmr26A0iNaO30e6s', videos: playlistVideos['PLRSo5uXl0WzWo9_rWLmr26A0iNaO30e6s'] },
      { title: 'Preparing for Practice — Videos from 2020 to 2024', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLRSo5uXl0WzVLe6VgIL3tLS7c7VXkqKIR', videos: playlistVideos['PLRSo5uXl0WzVLe6VgIL3tLS7c7VXkqKIR'] }
    ]
  },
  {
    slug: 'obgyn', name: 'OB/GYN', short: 'OB', description: 'OB/GYN education and fetal assessment resources.',
    current: [{ title: '2025 Fetal Assessment Workshop', presenter: 'Jenna Wright Greenman, JD; Satinder Kaur, MD; Kara Patek, MD; Gregory Goyart, MD; Jeffrey Johnson, MD', date: 'August 1, 2025', type: 'recording', url: 'https://www.youtube.com/watch?v=N2_shcDcRpw' }],
    archives: [{ title: 'OB/GYN and Fetal Assessment — Videos from 2020 to 2024', type: 'playlist', url: 'https://www.youtube.com/watch?v=Thke9h_D_A4&list=PLRSo5uXl0WzWNuKxAPsg7a6Y0bSJDHOJY', videos: playlistVideos['PLRSo5uXl0WzWNuKxAPsg7a6Y0bSJDHOJY'] }]
  },
  {
    slug: 'quality-improvement', name: 'Quality Improvement', short: 'QI', description: 'Training, tools, and recordings for effective quality improvement.',
    upcoming: [{ title: 'Virtual Fundamentals of Quality Improvement Bootcamp', type: 'course', url: 'https://lp.constantcontactpages.com/ev/reg/u8rb2ej', meta: 'Registration' }], current: [],
    archives: [
      { title: 'Quality Improvement — Videos from 2020 to 2025', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLRSo5uXl0WzUYxKMJ6g444ebK387tWlZ2', videos: playlistVideos['PLRSo5uXl0WzUYxKMJ6g444ebK387tWlZ2'] },
      { title: 'Research Forum and QI Summit — Videos from 2020 to 2024', type: 'playlist', url: 'https://www.youtube.com/playlist?list=PLRSo5uXl0WzW3g27334GwCEpSxlwBqONA', videos: playlistVideos['PLRSo5uXl0WzW3g27334GwCEpSxlwBqONA'] }
    ]
  },
  {
    slug: 'research', name: 'Research', short: 'RE', description: 'Research skills, workshops, forums, and publication opportunities.',
    upcoming: [{ title: 'Research Workshop Series', type: 'course', url: 'https://lp.constantcontactpages.com/ev/reg/6hnekd2', meta: 'Registration' }],
    current: [
      { title: 'Michigan Medical Education and Health Bulletin', type: 'resource', url: 'https://mmehb.scholasticahq.com/about', meta: 'Learn about the journal' },
      { title: 'Submit a Manuscript', type: 'resource', url: 'https://mmehb.scholasticahq.com/for-authors', meta: 'Author information and submissions' }
    ], archives: []
  },
  {
    slug: 'residency-coordinators', name: 'Residency Coordinators', short: 'RC', description: 'Professional development and practical resources for residency coordinators.',
    current: [], archives: [{ title: 'Residency Coordinators — Videos from 2022 to 2024', type: 'playlist', url: 'https://www.youtube.com/watch?v=CdKIjRAfA7Y&list=PLRSo5uXl0WzWZBaXLh-3SFeFXZ_acxR16', videos: playlistVideos['PLRSo5uXl0WzWZBaXLh-3SFeFXZ_acxR16'] }]
  },
  {
    slug: 'transitional-year', name: 'Transitional Year', short: 'TY', description: 'Programming and resources for transitional year residents and educators.',
    current: [], archives: [{ title: 'Transitional Year — Videos from 2021', type: 'playlist', url: 'https://www.youtube.com/watch?v=CdKIjRAfA7Y&list=PLRSo5uXl0WzWZBaXLh-3SFeFXZ_acxR16', videos: playlistVideos['PLRSo5uXl0WzWZBaXLh-3SFeFXZ_acxR16'] }]
  },
  {
    slug: 'well-being', name: 'Well-Being', short: 'WB', description: 'Evidence-informed learning for clinician and trainee well-being.',
    current: [{ title: 'Imposter Syndrome in Medicine', presenter: 'Alyssa Stephenson-Famy, MD', date: 'October 3, 2025', type: 'recording', url: 'https://youtu.be/nNedVz2RhwA' }],
    archives: [{ title: 'Well-Being — Videos from 2022 to 2025', type: 'playlist', url: 'https://www.youtube.com/watch?v=XBmc4rDh6Rc&list=PLRSo5uXl0WzXBKTccxMAMoEh5bCRBHIww', videos: playlistVideos['PLRSo5uXl0WzXBKTccxMAMoEh5bCRBHIww'] }]
  }
];

export const defaultBanner = {
  eyebrow: 'Featured program',
  title: 'Learn, connect, and grow with SEMCME',
  description: 'Explore virtual membership programs, recordings, and resources.',
  ctaLabel: 'View upcoming events',
  ctaUrl: 'https://semcme.org/events/'
};

export const defaultEvents = [
  {
    id: 'events-calendar', eyebrow: 'Upcoming programs', title: 'Discover what’s next at SEMCME',
    date: '', time: '', location: 'In person & virtual',
    description: 'Browse upcoming workshops, lectures, and member programs.',
    ctaLabel: 'View events calendar', ctaUrl: 'https://semcme.org/events/', backgroundImage: '', published: true
  },
  {
    id: 'medical-education-bulletin', eyebrow: 'Member opportunity', title: 'Share your work with the medical education community',
    date: '', time: '', location: 'Michigan Medical Education and Health Bulletin',
    description: 'Learn about the SEMCME journal and submission options.',
    ctaLabel: 'Learn about the journal', ctaUrl: 'https://mmehb.scholasticahq.com/', backgroundImage: '', published: true
  }
];
