import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  where
} from 'firebase/firestore';
import Swal from 'sweetalert2';
import './App.css';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCw171BYPreeNXeFZc0EbkMlaAEythUcUw",
  authDomain: "quiz-3df53.firebaseapp.com",
  projectId: "quiz-3df53",
  storageBucket: "quiz-3df53.firebasestorage.app",
  messagingSenderId: "93122957786",
  appId: "1:93122957786:web:12a21cc9e391b74bc4f0e3",
  measurementId: "G-8G75H4RM73"
};


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Session duration: 2 hours in milliseconds
const SESSION_DURATION = 2 * 60 * 60 * 1000;

// Get IP Address
const getIPAddress = async () => {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.error('Error fetching IP:', error);
    return 'Unknown';
  }
};

// Session helpers
const isSessionValid = () => {
  const sessionData = localStorage.getItem('quizSession');
  if (!sessionData) return false;
  const { expiry } = JSON.parse(sessionData);
  return Date.now() < expiry;
};

const saveSession = (teamData) => {
  const sessionData = {
    team: teamData,
    expiry: Date.now() + SESSION_DURATION
  };
  localStorage.setItem('quizSession', JSON.stringify(sessionData));
};

const getSession = () => {
  const sessionData = localStorage.getItem('quizSession');
  if (!sessionData) return null;
  const parsed = JSON.parse(sessionData);
  if (Date.now() > parsed.expiry) {
    localStorage.removeItem('quizSession');
    return null;
  }
  return parsed.team;
};

const clearSession = () => {
  localStorage.removeItem('quizSession');
};

export default function QuizApp() {
  // View state
  const [view, setView] = useState(() => {
    if (window.location.hash === '#admin') return 'adminLogin';
    return 'home';
  });
  
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  
  // Admin states
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Team/Auth states
  const [currentTeam, setCurrentTeam] = useState(null);
  
  // Registration form
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regTeamName, setRegTeamName] = useState('');
  const [regMembers, setRegMembers] = useState(['']);
  
  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Quiz states
  const [questions, setQuestions] = useState([]);
  const [shuffledQuestions, setShuffledQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [quizStatus, setQuizStatus] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [submitted, setSubmitted] = useState(false);

  // Admin question form
  const [newQuestion, setNewQuestion] = useState({
    question: '',
    options: ['', '', '', ''],
    correctAnswer: 0
  });

  const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // Check session on app load
  useEffect(() => {
    const checkSession = async () => {
      setIsLoading(true);
      const savedTeam = getSession();
      
      if (savedTeam && savedTeam.id) {
        try {
          const teamDoc = await getDoc(doc(db, 'teams', savedTeam.id));
          if (teamDoc.exists()) {
            const teamData = { id: teamDoc.id, ...teamDoc.data() };
            setCurrentTeam(teamData);
            setAnswers(teamData.answers || {});
            setSubmitted(teamData.submitted || false);
            
            if (teamData.questionOrder && teamData.questionOrder.length > 0) {
              const q = query(collection(db, 'questions'), orderBy('createdAt'));
              const querySnapshot = await getDocs(q);
              const allQuestions = [];
              querySnapshot.forEach((doc) => {
                allQuestions.push({ id: doc.id, ...doc.data() });
              });
              
              const orderedQuestions = teamData.questionOrder
                .map(id => allQuestions.find(q => q.id === id))
                .filter(Boolean);
              setShuffledQuestions(orderedQuestions);
              setQuestions(allQuestions);
            }
            
            if (window.location.hash !== '#admin') {
              setView('quiz');
            }
          } else {
            clearSession();
          }
        } catch (error) {
          console.error('Session check error:', error);
          clearSession();
        }
      }
      setIsLoading(false);
    };
    
    checkSession();
  }, []);

  // Quiz status listener
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'quiz', 'status'), (doc) => {
      if (doc.exists()) {
        setQuizStatus(doc.data());
      }
    });
    return () => unsubscribe();
  }, []);

  // Timer countdown
  useEffect(() => {
    if (quizStatus?.active && quizStatus?.endTime) {
      const interval = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(0, quizStatus.endTime - now);
        setTimeLeft(remaining);
        if (remaining === 0 && currentTeam && !submitted) {
          handleSubmitQuiz();
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [quizStatus, currentTeam, submitted]);

  // Real-time questions listener
  useEffect(() => {
    const q = query(collection(db, 'questions'), orderBy('createdAt'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const qs = [];
      snapshot.forEach((doc) => {
        qs.push({ id: doc.id, ...doc.data() });
      });
      setQuestions(qs);
    });
    return () => unsubscribe();
  }, []);

  // Leaderboard listener
  useEffect(() => {
    if (view === 'leaderboard' || (isAdmin && view === 'admin')) {
      const unsubscribe = onSnapshot(collection(db, 'teams'), (snapshot) => {
        const teams = [];
        snapshot.forEach((doc) => {
          teams.push({ id: doc.id, ...doc.data() });
        });
        teams.sort((a, b) => (b.score || 0) - (a.score || 0));
        setLeaderboard(teams);
      });
      return () => unsubscribe();
    }
  }, [view, isAdmin]);

  // Hash change handler
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#admin' && !isAdmin) {
        setView('adminLogin');
      } else if (window.location.hash !== '#admin-panel' && window.location.hash !== '#admin') {
        if (isAdmin) {
          setIsAdmin(false);
          setView('home');
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [isAdmin]);

  // ADMIN HANDLERS
  const handleAdminLogin = () => {
    if (adminPassword === 'eshean@2004') {
      setIsAdmin(true);
      setView('admin');
      window.location.hash = 'admin-panel';
      Swal.fire({
        icon: 'success',
        title: 'Welcome Admin!',
        text: 'Successfully logged in',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#4f46e5',
        timer: 2000,
        showConfirmButton: false
      });
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Access Denied',
        text: 'Incorrect password!',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#ef4444'
      });
    }
  };

  const handleAddQuestion = async () => {
    if (!newQuestion.question || newQuestion.options.some(opt => !opt)) {
      Swal.fire({
        icon: 'warning',
        title: 'Incomplete Form',
        text: 'Please fill all fields!',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }
    try {
      await addDoc(collection(db, 'questions'), {
        ...newQuestion,
        createdAt: Date.now()
      });
      setNewQuestion({
        question: '',
        options: ['', '', '', ''],
        correctAnswer: 0
      });
      Swal.fire({
        icon: 'success',
        title: 'Question Added!',
        text: 'Question added successfully',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#10b981',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Error adding question: ' + error.message,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#ef4444'
      });
    }
  };

  const handleDeleteQuestion = async (questionId) => {
    const result = await Swal.fire({
      title: 'Delete Question?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      background: 'rgba(255, 255, 255, 0.95)',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete it!',
      cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'questions', questionId));
        Swal.fire({
          icon: 'success',
          title: 'Deleted!',
          text: 'Question deleted successfully',
          background: 'rgba(255, 255, 255, 0.95)',
          confirmButtonColor: '#10b981',
          timer: 2000,
          showConfirmButton: false
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Error deleting question: ' + error.message,
          background: 'rgba(255, 255, 255, 0.95)',
          confirmButtonColor: '#ef4444'
        });
      }
    }
  };

  const handleStartQuiz = async (duration) => {
    try {
      await setDoc(doc(db, 'quiz', 'status'), {
        active: true,
        startTime: Date.now(),
        endTime: Date.now() + duration * 60 * 1000,
        duration: duration
      });
      Swal.fire({
        icon: 'success',
        title: 'Quiz Started!',
        html: `<p style="font-size: 1.1rem;">Quiz will run for <strong>${duration} minutes</strong></p>`,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#10b981',
        timer: 3000,
        showConfirmButton: false
      });
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Error starting quiz: ' + error.message,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#ef4444'
      });
    }
  };

  const handleStopQuiz = async () => {
    const result = await Swal.fire({
      title: 'Stop Quiz?',
      text: 'Are you sure you want to stop the quiz?',
      icon: 'warning',
      showCancelButton: true,
      background: 'rgba(255, 255, 255, 0.95)',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, stop it!',
      cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
      try {
        await setDoc(doc(db, 'quiz', 'status'), {
          active: false,
          endTime: null
        });
        Swal.fire({
          icon: 'success',
          title: 'Quiz Stopped!',
          text: 'The quiz has been stopped',
          background: 'rgba(255, 255, 255, 0.95)',
          confirmButtonColor: '#10b981',
          timer: 2000,
          showConfirmButton: false
        });
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Error stopping quiz: ' + error.message,
          background: 'rgba(255, 255, 255, 0.95)',
          confirmButtonColor: '#ef4444'
        });
      }
    }
  };

  // TEAM REGISTRATION
  const handleAddMember = () => {
    setRegMembers([...regMembers, '']);
  };

  const handleRemoveMember = (index) => {
    if (regMembers.length > 1) {
      const newMembers = regMembers.filter((_, i) => i !== index);
      setRegMembers(newMembers);
    }
  };

  const handleMemberChange = (index, value) => {
    const newMembers = [...regMembers];
    newMembers[index] = value;
    setRegMembers(newMembers);
  };

  const handleRegister = async () => {
    // Validation
    if (!regEmail || !regPassword || !regTeamName) {
      Swal.fire({
        icon: 'warning',
        title: 'Incomplete Form',
        text: 'Please fill email, password, and team name!',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    if (regPassword !== regConfirmPassword) {
      Swal.fire({
        icon: 'error',
        title: 'Password Mismatch',
        text: 'Passwords do not match!',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#ef4444'
      });
      return;
    }

    if (regPassword.length < 6) {
      Swal.fire({
        icon: 'warning',
        title: 'Weak Password',
        text: 'Password must be at least 6 characters!',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    const validMembers = regMembers.filter(m => m.trim() !== '');
    if (validMembers.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'No Members',
        text: 'Please add at least one team member!',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    try {
      // Get IP Address
      const ipAddress = await getIPAddress();

      // Check for duplicate IP
      const teamsSnapshot = await getDocs(collection(db, 'teams'));
      const duplicateIP = teamsSnapshot.docs.find(doc => doc.data().ipAddress === ipAddress);

      if (duplicateIP) {
        const result = await Swal.fire({
          icon: 'warning',
          title: 'IP Already Registered',
          html: `<p>A team (<strong>${duplicateIP.data().teamName}</strong>) has already registered from this IP address.</p><p>Do you still want to continue?</p>`,
          background: 'rgba(255, 255, 255, 0.95)',
          showCancelButton: true,
          confirmButtonColor: '#f59e0b',
          cancelButtonColor: '#6b7280',
          confirmButtonText: 'Yes, continue',
          cancelButtonText: 'Cancel'
        });

        if (!result.isConfirmed) return;
      }

      // Shuffle questions for new team
      const shuffled = shuffleArray(questions);
      const questionOrder = shuffled.map(q => q.id);

      // Create team document
      const teamData = {
        email: regEmail,
        password: regPassword,
        teamName: regTeamName,
        members: validMembers,
        ipAddress: ipAddress,
        registeredAt: Date.now(),
        lastLogin: Date.now(),
        answers: {},
        score: 0,
        submitted: false,
        questionOrder: questionOrder
      };

      const docRef = await addDoc(collection(db, 'teams'), teamData);
      const teamWithId = { id: docRef.id, ...teamData };

      // Save session
      saveSession(teamWithId);
      setCurrentTeam(teamWithId);
      setShuffledQuestions(shuffled);

      Swal.fire({
        icon: 'success',
        title: 'Registration Successful!',
        text: `Welcome, ${regTeamName}!`,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#10b981',
        timer: 2000,
        showConfirmButton: false
      });

      // Clear form
      setRegEmail('');
      setRegPassword('');
      setRegConfirmPassword('');
      setRegTeamName('');
      setRegMembers(['']);

      setView('quiz');

    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Registration Failed',
        text: error.message,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#ef4444'
      });
    }
  };

  // TEAM LOGIN
  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Fields',
        text: 'Please enter email and password!',
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#f59e0b'
      });
      return;
    }

    try {
      // Find team by email
      const teamsSnapshot = await getDocs(collection(db, 'teams'));
      const teamDoc = teamsSnapshot.docs.find(doc => doc.data().email === loginEmail);

      if (!teamDoc) {
        Swal.fire({
          icon: 'error',
          title: 'Team Not Found',
          text: 'No team found with this email!',
          background: 'rgba(255, 255, 255, 0.95)',
          confirmButtonColor: '#ef4444'
        });
        return;
      }

      const teamData = teamDoc.data();

      // Check password
      if (teamData.password !== loginPassword) {
        Swal.fire({
          icon: 'error',
          title: 'Wrong Password',
          text: 'Incorrect password!',
          background: 'rgba(255, 255, 255, 0.95)',
          confirmButtonColor: '#ef4444'
        });
        return;
      }

      // Update last login
      await updateDoc(doc(db, 'teams', teamDoc.id), {
        lastLogin: Date.now()
      });

      const teamWithId = { id: teamDoc.id, ...teamData };

      // Restore shuffled questions
      if (teamData.questionOrder && teamData.questionOrder.length > 0) {
        const orderedQuestions = teamData.questionOrder
          .map(id => questions.find(q => q.id === id))
          .filter(Boolean);
        setShuffledQuestions(orderedQuestions);
      }

      // Save session
      saveSession(teamWithId);
      setCurrentTeam(teamWithId);
      setAnswers(teamData.answers || {});
      setSubmitted(teamData.submitted || false);

      Swal.fire({
        icon: 'success',
        title: 'Login Successful!',
        text: `Welcome back, ${teamData.teamName}!`,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#10b981',
        timer: 2000,
        showConfirmButton: false
      });

      setLoginEmail('');
      setLoginPassword('');
      setView('quiz');

    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Login Failed',
        text: error.message,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#ef4444'
      });
    }
  };

  // TEAM LOGOUT
  const handleLogout = () => {
    clearSession();
    setCurrentTeam(null);
    setAnswers({});
    setSubmitted(false);
    setShuffledQuestions([]);
    setView('home');
    
    Swal.fire({
      icon: 'success',
      title: 'Logged Out',
      text: 'You have been logged out successfully',
      background: 'rgba(255, 255, 255, 0.95)',
      confirmButtonColor: '#10b981',
      timer: 2000,
      showConfirmButton: false
    });
  };

  // QUIZ HANDLERS
  const handleAnswerChange = (questionId, optionIndex) => {
    setAnswers({ ...answers, [questionId]: optionIndex });
  };

  const handleSubmitQuiz = async () => {
    if (submitted) return;

    const result = await Swal.fire({
      title: 'Submit Quiz?',
      text: 'Are you sure you want to submit? You cannot change answers after submission.',
      icon: 'question',
      showCancelButton: true,
      background: 'rgba(255, 255, 255, 0.95)',
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, submit!',
      cancelButtonText: 'Review answers'
    });

    if (!result.isConfirmed) return;

    try {
      let score = 0;
      shuffledQuestions.forEach((q) => {
        if (answers[q.id] === q.correctAnswer) {
          score++;
        }
      });

      await updateDoc(doc(db, 'teams', currentTeam.id), {
        answers: answers,
        score: score,
        submitted: true,
        submittedAt: Date.now()
      });

      setSubmitted(true);

      Swal.fire({
        icon: 'success',
        title: 'Quiz Submitted!',
        html: `
          <div style="font-size: 1.1rem;">
            <p>Your score: <strong style="font-size: 1.5rem; color: #10b981;">${score}/${shuffledQuestions.length}</strong></p>
            <p style="margin-top: 1rem;">Percentage: <strong>${Math.round((score/shuffledQuestions.length)*100)}%</strong></p>
          </div>
        `,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#3b82f6',
        confirmButtonText: 'View Leaderboard'
      }).then(() => {
        setView('leaderboard');
      });

    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Submission Error',
        text: error.message,
        background: 'rgba(255, 255, 255, 0.95)',
        confirmButtonColor: '#ef4444'
      });
    }
  };

  const formatTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // LOADING SCREEN
  if (isLoading) {
    return (
      <div className="gradient-bg-centered">
        <div className="glass-container text-center">
          <h2>Loading...</h2>
          <p className="text-white-80">Please wait</p>
        </div>
      </div>
    );
  }

  // HOME VIEW
  if (view === 'home') {
    return (
      <div className="gradient-bg-centered">
        <div className="glass-container">
          <h1>IT Fest Quiz</h1>
          <p className="subtitle">College Quiz Competition</p>
          <div className="space-y-4">
            <button onClick={() => setView('login')} className="btn-primary">
              Login
            </button>
            <button onClick={() => setView('register')} className="btn-primary">
              Register Team
            </button>
            <button onClick={() => setView('leaderboard')} className="btn-secondary">
              View Leaderboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // LOGIN VIEW
  if (view === 'login') {
    return (
      <div className="gradient-bg-centered">
        <div className="glass-container">
          <h2>Team Login</h2>
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            placeholder="Email"
          />
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            placeholder="Password"
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
          />
          <div className="space-y-3">
            <button onClick={handleLogin} className="btn-primary">
              Login
            </button>
            <button onClick={() => setView('home')} className="btn-secondary">
              Back
            </button>
          </div>
          <p className="text-sm text-white-60 text-center mt-4">
            Don't have an account? <span className="link" onClick={() => setView('register')}>Register here</span>
          </p>
        </div>
      </div>
    );
  }

  // REGISTER VIEW
  if (view === 'register') {
    return (
      <div className="gradient-bg-centered">
        <div className="glass-container">
          <h2>Team Registration</h2>
          
          <input
            type="email"
            value={regEmail}
            onChange={(e) => setRegEmail(e.target.value)}
            placeholder="Email"
          />
          <input
            type="password"
            value={regPassword}
            onChange={(e) => setRegPassword(e.target.value)}
            placeholder="Password"
          />
          <input
            type="password"
            value={regConfirmPassword}
            onChange={(e) => setRegConfirmPassword(e.target.value)}
            placeholder="Confirm Password"
          />
          <input
            type="text"
            value={regTeamName}
            onChange={(e) => setRegTeamName(e.target.value)}
            placeholder="Team Name"
          />

          <div className="members-section">
            <label className="text-white mb-2">Team Members</label>
            {regMembers.map((member, index) => (
              <div key={index} className="member-row">
                <input
                  type="text"
                  value={member}
                  onChange={(e) => handleMemberChange(index, e.target.value)}
                  placeholder={`Member ${index + 1} Name`}
                />
                {regMembers.length > 1 && (
                  <button 
                    onClick={() => handleRemoveMember(index)} 
                    className="btn-red btn-small"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button onClick={handleAddMember} className="btn-secondary btn-small mt-2">
              + Add Member
            </button>
          </div>

          <div className="space-y-3 mt-4">
            <button onClick={handleRegister} className="btn-green">
              Register
            </button>
            <button onClick={() => setView('home')} className="btn-secondary">
              Back
            </button>
          </div>
          <p className="text-sm text-white-60 text-center mt-4">
            Already registered? <span className="link" onClick={() => setView('login')}>Login here</span>
          </p>
        </div>
      </div>
    );
  }

  // ADMIN LOGIN
  if (view === 'adminLogin') {
    return (
      <div className="gradient-bg-centered">
        <div className="glass-container">
          <h2>Admin Login</h2>
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="Enter admin password"
            onKeyPress={(e) => e.key === 'Enter' && handleAdminLogin()}
          />
          <div className="space-y-3">
            <button onClick={handleAdminLogin} className="btn-primary">
              Login
            </button>
            <button 
              onClick={() => { setView('home'); window.location.hash = ''; }} 
              className="btn-secondary"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ADMIN PANEL
  if (view === 'admin' && isAdmin) {
    return (
      <div className="gradient-bg">
        <div className="container">
          <div className="header">
            <h1>Admin Panel</h1>
            <button 
              onClick={() => { setView('home'); setIsAdmin(false); window.location.hash = ''; }} 
              className="btn-red btn-small"
            >
              Logout
            </button>
          </div>

          {/* Quiz Control */}
          <div className="glass-card">
            <h2>Quiz Control</h2>
            <div className="quiz-control-buttons">
              <button
                onClick={() => handleStartQuiz(60)}
                disabled={quizStatus?.active}
                className="btn-green"
              >
                Start Quiz (60 min)
              </button>
              <button
                onClick={() => handleStartQuiz(30)}
                disabled={quizStatus?.active}
                className="btn-green"
              >
                Start Quiz (30 min)
              </button>
              <button
                onClick={handleStopQuiz}
                disabled={!quizStatus?.active}
                className="btn-red"
              >
                Stop Quiz
              </button>
              <span className={`status-badge ${quizStatus?.active ? 'status-active' : 'status-inactive'}`}>
                {quizStatus?.active ? `Active - ${formatTime(timeLeft)} left` : 'Inactive'}
              </span>
            </div>
          </div>

          {/* Add Question */}
          <div className="glass-card question-form">
            <h2>Add New Question</h2>
            <input
              type="text"
              value={newQuestion.question}
              onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
              placeholder="Question"
            />
            {newQuestion.options.map((opt, idx) => (
              <div key={idx} className="option-row">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const newOpts = [...newQuestion.options];
                    newOpts[idx] = e.target.value;
                    setNewQuestion({ ...newQuestion, options: newOpts });
                  }}
                  placeholder={`Option ${idx + 1}`}
                />
                <button
                  onClick={() => setNewQuestion({ ...newQuestion, correctAnswer: idx })}
                  className={newQuestion.correctAnswer === idx ? 'correct-btn' : 'incorrect-btn'}
                >
                  Correct
                </button>
              </div>
            ))}
            <button onClick={handleAddQuestion} className="btn-blue mt-3">
              Add Question
            </button>
          </div>

          {/* Questions List */}
          <div className="glass-card">
            <h2>Questions ({questions.length})</h2>
            <div className="space-y-4">
              {questions.map((q, idx) => (
                <div key={q.id} className="question-item">
                  <div className="question-header">
                    <h3>Q{idx + 1}. {q.question}</h3>
                    <button onClick={() => handleDeleteQuestion(q.id)} className="btn-red btn-small">
                      Delete
                    </button>
                  </div>
                  <div className="space-y-1 mb-2">
                    {q.options.map((opt, optIdx) => (
                      <div key={optIdx} className={optIdx === q.correctAnswer ? 'option-correct' : 'option-normal'}>
                        {String.fromCharCode(65 + optIdx)}. {opt}
                        {optIdx === q.correctAnswer && <span className="ml-2 text-green-light">✓ Correct Answer</span>}
                      </div>
                    ))}
                  </div>
                  <div className="answer-info">
                    <strong>Correct Answer:</strong> Option {String.fromCharCode(65 + q.correctAnswer)} - {q.options[q.correctAnswer]}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Teams & IP Log */}
          <div className="glass-card">
            <h2>Registered Teams & IP Log ({leaderboard.length})</h2>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Team Name</th>
                    <th>Email</th>
                    <th>Members</th>
                    <th>IP Address</th>
                    <th>Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((team, idx) => (
                    <tr key={team.id} className={idx < 3 ? 'top-three-row' : ''}>
                      <td className="font-bold">
                        {idx === 0 && '🥇 '}
                        {idx === 1 && '🥈 '}
                        {idx === 2 && '🥉 '}
                        {team.teamName}
                      </td>
                      <td>{team.email}</td>
                      <td>{team.members?.join(', ') || 'N/A'}</td>
                      <td><code>{team.ipAddress || 'N/A'}</code></td>
                      <td className="font-bold">{team.score || 0}/{questions.length}</td>
                      <td>
                        <span className={`status-badge text-sm ${team.submitted ? 'status-submitted' : 'status-progress'}`}>
                          {team.submitted ? 'Submitted' : 'In Progress'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // QUIZ VIEW
  if (view === 'quiz' && currentTeam) {
    if (!quizStatus?.active) {
      return (
        <div className="gradient-bg-centered">
          <div className="glass-container text-center">
            <h2>Quiz Not Active</h2>
            <p className="text-white-80 mb-6">The quiz hasn't started yet. Please wait for the admin to start.</p>
            <p className="text-white-60 mb-4">Logged in as: <strong>{currentTeam.teamName}</strong></p>
            <div className="space-y-3">
              <button onClick={() => setView('leaderboard')} className="btn-primary">
                View Leaderboard
              </button>
              <button onClick={handleLogout} className="btn-red">
                Logout
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (submitted) {
      return (
        <div className="gradient-bg-centered">
          <div className="glass-container text-center">
            <h2 className="text-green-light">Quiz Submitted!</h2>
            <p className="text-white-80 mb-6">Your answers have been recorded successfully.</p>
            <div className="space-y-3">
              <button onClick={() => setView('leaderboard')} className="btn-primary">
                View Leaderboard
              </button>
              <button onClick={handleLogout} className="btn-red">
                Logout
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="gradient-bg">
        <div className="container-md">
          <div className="glass-card">
            <div className="flex-between">
              <div>
                <h2>Team: {currentTeam.teamName}</h2>
                <p className="text-white-60 text-sm">Members: {currentTeam.members?.join(', ')}</p>
              </div>
              <div className="text-right">
                <div className="timer-display">{formatTime(timeLeft)}</div>
                <div className="timer-label">Time Remaining</div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {shuffledQuestions.map((q, idx) => (
              <div key={q.id} className="glass-card">
                <h3>Q{idx + 1}. {q.question}</h3>
                <div className="space-y-2">
                  {q.options.map((opt, optIdx) => (
                    <label
                      key={optIdx}
                      className={`quiz-option ${answers[q.id] === optIdx ? 'quiz-option-selected' : 'quiz-option-normal'}`}
                    >
                      <input
                        type="radio"
                        name={`question-${q.id}`}
                        checked={answers[q.id] === optIdx}
                        onChange={() => handleAnswerChange(q.id, optIdx)}
                      />
                      <span className="font-semibold mr-2">{String.fromCharCode(65 + optIdx)}.</span>
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="glass-card mt-6">
            <div className="flex-between">
              <button onClick={handleLogout} className="btn-red btn-small">
                Logout
              </button>
              <button onClick={handleSubmitQuiz} className="btn-green btn-large">
                Submit Quiz
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LEADERBOARD VIEW
  if (view === 'leaderboard') {
    return (
      <div className="gradient-bg">
        <div className="container-lg">
          <div className="glass-container-large">
            <h1>🏆 Leaderboard 🏆</h1>
            {leaderboard.length === 0 ? (
              <p className="text-center text-white-80">No teams have participated yet.</p>
            ) : (
              <div className="space-y-4">
                {leaderboard.slice(0, 3).map((team, idx) => (
                  <div
                    key={team.id}
                    className={`podium-card ${idx === 0 ? 'podium-gold' : idx === 1 ? 'podium-silver' : 'podium-bronze'}`}
                  >
                    <div className="podium-content">
                      <div className="podium-left">
                        <span className="podium-emoji">
                          {idx === 0 && '🥇'}
                          {idx === 1 && '🥈'}
                          {idx === 2 && '🥉'}
                        </span>
                        <div>
                          <h3 className="podium-title">{team.teamName}</h3>
                          <p className="podium-subtitle">
                            {idx === 0 ? '1st Place' : idx === 1 ? '2nd Place' : '3rd Place'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="podium-score">{team.score || 0}</div>
                        <div className="podium-label">points</div>
                      </div>
                    </div>
                  </div>
                ))}

                {leaderboard.length > 3 && (
                  <div className="mt-6">
                    <h3 className="other-teams-title">Other Teams</h3>
                    <div className="space-y-2">
                      {leaderboard.slice(3).map((team, idx) => (
                        <div key={team.id} className="team-row">
                          <div>
                            <span className="team-rank">#{idx + 4}</span>
                            <span className="team-name">{team.teamName}</span>
                          </div>
                          <span className="team-score">{team.score || 0} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button onClick={() => setView(currentTeam ? 'quiz' : 'home')} className="btn-primary mt-8">
              {currentTeam ? 'Back to Quiz' : 'Back to Home'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}